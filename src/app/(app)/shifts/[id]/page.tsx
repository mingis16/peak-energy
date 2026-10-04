import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpenCheck } from "lucide-react";
import { deleteReading, deleteShift, reviewShift, saveHandover, saveReadings } from "../actions";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { HandoverForm } from "@/components/shifts/handover-form";
import { ReadingsForm, type ReadingRow } from "@/components/shifts/readings-form";
import { VarianceCell } from "@/components/shifts/shift-table";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { shiftStatusBadge } from "@/components/ui/status-badge";
import { buttonDanger, buttonSecondary, buttonSmall } from "@/components/ui/styles";
import { getStationSettings, isManager, requireStaff } from "@/lib/auth";
import { row, rows } from "@/lib/data";
import { formatDate, formatDateTime, formatLiters, formatMoney } from "@/lib/format";
import type { FuelProduct, PumpReading, ShiftSummary } from "@/lib/types";

export const metadata: Metadata = { title: "Shift" };

interface PumpWithTank {
  id: string;
  pump_number: string;
  current_meter: number;
  is_active: boolean;
  tanks: { tank_name: string; fuel_type: string } | null;
}

export default async function ShiftPage({ params }: PageProps<"/shifts/[id]">) {
  const { id } = await params;
  const { supabase, profile } = await requireStaff();
  const settings = await getStationSettings();
  const currency = settings.currency_code;
  const manager = isManager(profile.role);

  const [shiftResult, readingsResult, pumpsResult, productsResult] = await Promise.all([
    supabase.from("v_shift_summary").select("*").eq("id", id).maybeSingle(),
    supabase.from("pump_readings").select("*").eq("shift_id", id),
    supabase
      .from("pumps")
      .select("id, pump_number, current_meter, is_active, tanks(tank_name, fuel_type)")
      .order("pump_number"),
    supabase.from("fuel_products").select("*"),
  ]);

  const shift = row<ShiftSummary>(shiftResult, "shift");
  if (!shift) notFound();
  const readings = rows<PumpReading>(readingsResult, "meter readings");
  const pumps = rows<PumpWithTank>(pumpsResult, "pumps");
  const prices = new Map(rows<FuelProduct>(productsResult, "fuel prices").map((p) => [p.code, p.price_per_liter]));

  const ownShift = shift.attendant_id === profile.id;
  const editable = shift.status === "OPEN" && (manager || ownShift);
  const readingByPump = new Map(readings.map((r) => [r.pump_number, r]));

  const readingRows: ReadingRow[] = pumps
    .filter((p) => readingByPump.has(p.pump_number) || (editable && p.is_active))
    .map((pump) => {
      const reading = readingByPump.get(pump.pump_number);
      const fuelType = reading?.fuel_type ?? pump.tanks?.fuel_type ?? "";
      return {
        pumpId: pump.id,
        pumpNumber: pump.pump_number,
        tankName: pump.tanks?.tank_name ?? "",
        fuelType,
        price: Number(reading?.price_per_liter ?? prices.get(fuelType) ?? 0),
        opening: Number(reading?.opening_meter ?? pump.current_meter),
        closing: reading ? Number(reading.closing_meter) : null,
        saved: Boolean(reading),
      };
    });

  const zeroPrices = editable && readingRows.some((r) => r.price === 0);
  const shiftName = shift.shift_label === "Day" ? "Full-day shift" : `${shift.shift_label} shift`;

  return (
    <>
      <Link
        href="/shifts"
        className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        <ArrowLeft className="h-4 w-4" /> All shifts
      </Link>
      <PageHeader
        title={`${shiftName} · ${formatDate(shift.shift_date)}`}
        description={
          <>
            {shift.attendant_name} · opened {formatDateTime(shift.opened_at)}
            {shift.submitted_at && <> · handed over {formatDateTime(shift.submitted_at)}</>}
            {shift.reconciled_at && <> · reconciled {formatDateTime(shift.reconciled_at)}</>}
          </>
        }
        actions={
          <>
            {shiftStatusBadge(shift.status, shift.is_short)}
            <RealtimeRefresh channel={`shift-${shift.id}`} tables={["shifts", "pump_readings"]} />
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Litres sold" value={formatLiters(shift.liters_sold, 1)} />
          <StatTile label="Expected sales" value={formatMoney(shift.expected_sales, currency)} detail="Pump meters × price" />
          <StatTile
            label="Collected"
            value={shift.status === "OPEN" && !shift.total_collected ? "—" : formatMoney(shift.total_collected, currency)}
            detail="Cash + credit + transfers"
          />
          <StatTile
            label="Difference"
            value={<VarianceCell shift={shift} currency={currency} />}
            detail={shift.status === "OPEN" ? "Calculated at handover" : "Collected − expected"}
          />
        </div>

        <Card
          title="Pump meter readings"
          description={
            editable
              ? "Enter each pump's closing totaliser. Opening meters carry over from the last shift."
              : "Readings are locked once the shift is handed over."
          }
        >
          {zeroPrices && (
            <p className="mb-4 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
              Some fuels have no pump price yet. A manager can set prices in Settings before readings are saved.
            </p>
          )}
          {readingRows.length === 0 ? (
            <EmptyState>
              {editable ? "No active pumps. A manager can add pumps in Settings." : "No meter readings were recorded."}
            </EmptyState>
          ) : (
            <ReadingsForm
              rows={readingRows}
              currency={currency}
              editable={editable}
              action={saveReadings.bind(null, shift.id)}
            />
          )}
          {editable && readings.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 text-xs text-zinc-500 dark:border-zinc-900 dark:text-zinc-400">
              <span>Remove a saved reading:</span>
              {readings.map((r) => (
                <ActionForm key={r.id} action={deleteReading.bind(null, r.id)} showSuccess={false}>
                  <SubmitButton
                    className={`${buttonDanger} ${buttonSmall}`}
                    confirm={`Remove the reading for pump ${r.pump_number}? Its litres go back into the tank.`}
                  >
                    {r.pump_number}
                  </SubmitButton>
                </ActionForm>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Shift handover"
          description="Declare what was collected. The system compares it with the pump meters."
        >
          {editable || (manager && shift.status === "SUBMITTED") ? (
            <HandoverForm
              initial={{
                cash_on_hand: Number(shift.cash_on_hand),
                credit_slips_amount: Number(shift.credit_slips_amount),
                digital_transfers_amount: Number(shift.digital_transfers_amount),
              }}
              notes={shift.notes}
              expectedSales={Number(shift.expected_sales)}
              currency={currency}
              tolerance={Number(settings.shortage_tolerance)}
              mode={shift.status === "OPEN" ? "attendant" : "correction"}
              action={saveHandover.bind(null, shift.id)}
            />
          ) : (
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <Amount label="Cash on hand" value={formatMoney(shift.cash_on_hand, currency)} />
              <Amount label="Credit slips" value={formatMoney(shift.credit_slips_amount, currency)} />
              <Amount label="Bank / mobile money" value={formatMoney(shift.digital_transfers_amount, currency)} />
              {shift.notes && (
                <div className="sm:col-span-3">
                  <dt className="text-zinc-500 dark:text-zinc-400">Notes</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{shift.notes}</dd>
                </div>
              )}
            </dl>
          )}
        </Card>

        {manager && shift.status !== "OPEN" && (
          <Card
            title="Manager review"
            description={
              shift.status === "SUBMITTED"
                ? "Approving posts the shift to the ledger: sales, cash, receivables, any shortage and the cost of fuel sold."
                : "This shift is posted to the ledger and locked."
            }
          >
            <ActionForm action={reviewShift.bind(null, shift.id)} className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                {shift.status === "SUBMITTED" ? (
                  <>
                    <SubmitButton name="intent" value="approve">
                      Approve &amp; post to ledger
                    </SubmitButton>
                    <SubmitButton
                      name="intent"
                      value="return"
                      className={buttonSecondary}
                      confirm="Send this shift back to the attendant? Readings will unlock."
                    >
                      Send back to attendant
                    </SubmitButton>
                  </>
                ) : (
                  <>
                    <Link href={`/accounting?tab=ledger&entry=${shift.journal_entry_id}`} className={buttonSecondary}>
                      <BookOpenCheck className="h-4 w-4" /> View ledger entry
                    </Link>
                    <SubmitButton
                      name="intent"
                      value="reopen"
                      className={buttonSecondary}
                      confirm="Re-open this shift for review? Its ledger posting will be reversed until you approve it again."
                    >
                      Re-open for review
                    </SubmitButton>
                  </>
                )}
              </div>
            </ActionForm>
          </Card>
        )}

        {shift.status === "OPEN" && (manager || ownShift) && (
          <ActionForm action={deleteShift.bind(null, shift.id)} className="flex flex-col items-start gap-2">
            <SubmitButton
              className={buttonDanger}
              confirm="Delete this shift and all of its meter readings? Litres go back into the tanks."
            >
              Delete shift
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </>
  );
}

function Amount({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}
