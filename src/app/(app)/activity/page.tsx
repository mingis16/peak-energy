import type { Metadata } from "next";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { StatusBadge, type Tone } from "@/components/ui/status-badge";
import { numClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { getStationSettings, requireOwner } from "@/lib/auth";
import { rows } from "@/lib/data";
import { addDaysISO, formatDateTime, formatMoney, formatNumber, todayISO } from "@/lib/format";
import { barWords } from "@/lib/station";
import type { AuditEntry, MeterCorrection, Profile, ShiftSummary } from "@/lib/types";

export const metadata: Metadata = { title: "Activity" };

function recordLabels(bar: ReturnType<typeof barWords>): Record<string, string> {
  return {
    tanks: "tank",
    dispensers: "pump",
    pumps: "nozzle",
    fuel_products: "fuel price",
    station_settings: "station settings",
    profiles: "staff member",
    shifts: "shift",
    pump_readings: "meter reading",
    tank_dips: "dip",
    fuel_deliveries: "fuel delivery",
    bar_inventory: `${bar.name} ${bar.item}`,
    bar_sales: `${bar.name} sale`,
    bar_restocks: `${bar.name} restock`,
    financial_transactions: "cash book entry",
    transaction_categories: "cash-book category",
  };
}

const ACTIONS: Record<AuditEntry["action"], { label: string; tone: Tone }> = {
  INSERT: { label: "Added", tone: "neutral" },
  UPDATE: { label: "Changed", tone: "warning" },
  STOCK_SET: { label: "Set stock of", tone: "warning" },
  DELETE: { label: "Deleted", tone: "critical" },
};

// Internal links and bookkeeping that mean nothing to a reader.
const HIDDEN_FIELDS = new Set([
  "id",
  "created_at",
  "updated_at",
  "opened_at",
  "journal_entry_id",
  "recorded_by",
  "created_by",
  "reconciled_by",
  "attendant_id",
  "shift_id",
  "tank_id",
  "item_id",
]);

function show(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return formatNumber(value, 2);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function describe(entry: AuditEntry): string {
  const label = (key: string) => key.replace(/_/g, " ");
  if (entry.action === "UPDATE" || entry.action === "STOCK_SET") {
    return Object.keys(entry.new_data ?? {})
      .filter((key) => !HIDDEN_FIELDS.has(key))
      .map((key) => `${label(key)}: ${show(entry.old_data?.[key])} → ${show(entry.new_data?.[key])}`)
      .join(" · ");
  }
  const data = (entry.action === "DELETE" ? entry.old_data : entry.new_data) ?? {};
  return Object.entries(data)
    .filter(([key, value]) => !HIDDEN_FIELDS.has(key) && value !== null)
    .slice(0, 6)
    .map(([key, value]) => `${label(key)}: ${show(value)}`)
    .join(" · ");
}

export default async function ActivityPage() {
  const { supabase } = await requireOwner();
  const settings = await getStationSettings();
  const currency = settings.currency_code;
  const recordLabel = recordLabels(barWords(settings));

  const [shiftsResult, correctionsResult, auditResult, staffResult] = await Promise.all([
    supabase.from("v_shift_summary").select("*").gte("shift_date", addDaysISO(todayISO(), -29)).neq("status", "OPEN"),
    supabase.from("meter_corrections").select("*").order("corrected_at", { ascending: false }).limit(50),
    supabase.from("audit_log").select("*").order("happened_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const shifts = rows<ShiftSummary>(shiftsResult, "shifts");
  const corrections = rows<MeterCorrection>(correctionsResult, "meter corrections");
  const audit = rows<AuditEntry>(auditResult, "activity log");
  const names = new Map(
    rows<Pick<Profile, "id" | "full_name" | "email">>(staffResult, "staff").map((p) => [p.id, p.full_name || p.email || "—"]),
  );

  // How often, and by how much, each attendant's cash came up short.
  const byAttendant = new Map<string, { name: string; shifts: number; flagged: number; short: number; over: number }>();
  for (const s of shifts) {
    const entry = byAttendant.get(s.attendant_id) ?? { name: s.attendant_name, shifts: 0, flagged: 0, short: 0, over: 0 };
    const variance = Number(s.variance ?? 0);
    entry.shifts += 1;
    if (s.is_short) entry.flagged += 1;
    if (variance < 0) entry.short -= variance;
    else entry.over += variance;
    byAttendant.set(s.attendant_id, entry);
  }
  const attendants = [...byAttendant.values()].sort((a, b) => b.short - a.short);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Only the owner sees this page. Nothing on it can be edited or deleted, by anyone."
      />

      <div className="flex flex-col gap-5">
        <Card
          title="Cash shortages by attendant"
          description="Handed-over shifts in the last 30 days. Shortages that keep coming back are worth a conversation."
        >
          {attendants.length === 0 ? (
            <EmptyState>No handed-over shifts in the last 30 days.</EmptyState>
          ) : (
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Attendant</th>
                    <th className={`${thClass} ${numClass}`}>Shifts</th>
                    <th className={`${thClass} ${numClass}`}>Flagged short</th>
                    <th className={`${thClass} ${numClass}`}>Total short</th>
                    <th className={`${thClass} ${numClass}`}>Total over</th>
                  </tr>
                </thead>
                <tbody>
                  {attendants.map((a) => (
                    <tr key={a.name}>
                      <td className={tdClass}>{a.name}</td>
                      <td className={`${tdClass} ${numClass}`}>{a.shifts}</td>
                      <td className={`${tdClass} ${numClass}`}>
                        {a.flagged > 0 ? <StatusBadge tone="critical">{a.flagged}</StatusBadge> : 0}
                      </td>
                      <td className={`${tdClass} ${numClass}`}>{formatMoney(a.short, currency)}</td>
                      <td className={`${tdClass} ${numClass}`}>{formatMoney(a.over, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card
          title="Meter corrections"
          description="Every manual change to a nozzle's meter. Once a nozzle is in use, only the owner can make one, with a reason."
        >
          {corrections.length === 0 ? (
            <EmptyState>No meter changes yet.</EmptyState>
          ) : (
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>When</th>
                    <th className={thClass}>Nozzle</th>
                    <th className={`${thClass} ${numClass}`}>From</th>
                    <th className={`${thClass} ${numClass}`}>To</th>
                    <th className={thClass}>Reason</th>
                    <th className={thClass}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {corrections.map((c) => (
                    <tr key={c.id}>
                      <td className={tdClass}>{formatDateTime(c.corrected_at)}</td>
                      <td className={tdClass}>{c.pump_number}</td>
                      <td className={`${tdClass} ${numClass}`}>{formatNumber(c.old_meter, 2)}</td>
                      <td className={`${tdClass} ${numClass}`}>{formatNumber(c.new_meter, 2)}</td>
                      <td className={tdClass}>
                        {c.during_setup ? <StatusBadge tone="neutral">Setup</StatusBadge> : c.reason}
                      </td>
                      <td className={tdClass}>{(c.corrected_by && names.get(c.corrected_by)) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card title="Changes and deletions" description="The latest 200 changes across the station, and who made them.">
          {audit.length === 0 ? (
            <EmptyState>Nothing has been changed or deleted yet.</EmptyState>
          ) : (
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>When</th>
                    <th className={thClass}>Who</th>
                    <th className={thClass}>What</th>
                    <th className={thClass}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((entry) => {
                    const action = ACTIONS[entry.action] ?? { label: entry.action, tone: "neutral" as Tone };
                    return (
                      <tr key={entry.id}>
                        <td className={`${tdClass} whitespace-nowrap`}>{formatDateTime(entry.happened_at)}</td>
                        <td className={tdClass}>{entry.actor_name ?? "System"}</td>
                        <td className={`${tdClass} whitespace-nowrap`}>
                          <StatusBadge tone={action.tone}>
                            {action.label} {recordLabel[entry.table_name] ?? entry.table_name}
                          </StatusBadge>
                        </td>
                        <td className={`${tdClass} min-w-64 whitespace-normal text-xs text-zinc-600 dark:text-zinc-300`}>
                          {describe(entry)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
