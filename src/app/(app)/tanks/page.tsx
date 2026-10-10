import type { Metadata } from "next";
import Link from "next/link";
import { deleteDelivery, deleteDip, recordDelivery, recordDip } from "./actions";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { TankMeter } from "@/components/dashboard/tank-meter";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { DeleteButton } from "@/components/ui/delete-button";
import { Field } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { inputClass, numClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { getStationSettings, isManager, requireStaff } from "@/lib/auth";
import { rows } from "@/lib/data";
import {
  addDaysISO,
  formatDate,
  formatLiters,
  formatMoney,
  formatNumber,
  formatPercent,
  attendantDateLimits,
  PAYMENT_LABELS,
  todayISO,
} from "@/lib/format";
import type { FuelDelivery, TankDip, TankStatus, WetstockDay } from "@/lib/types";

export const metadata: Metadata = { title: "Tanks" };

export default async function TanksPage() {
  const { supabase, profile } = await requireStaff();
  const settings = await getStationSettings();
  const manager = isManager(profile.role);
  // Closing dips reveal losses; attendants record them only if the owner allows it.
  const closingDips = manager || settings.attendants_record_closing_dips;
  const currency = settings.currency_code;
  const since = addDaysISO(todayISO(), -13);
  const empty = Promise.resolve({ data: [], error: null });

  const [tanksResult, dipsResult, deliveriesResult, wetstockResult] = await Promise.all([
    supabase.from("v_tank_status").select("*").order("tank_name"),
    supabase
      .from("tank_dips")
      .select("*")
      .gte("dip_date", since)
      .order("dip_date", { ascending: false })
      .order("created_at", { ascending: false }),
    manager
      ? supabase.from("fuel_deliveries").select("*").gte("delivery_date", addDaysISO(todayISO(), -59)).order("delivery_date", { ascending: false }).order("created_at", { ascending: false })
      : empty,
    manager
      ? supabase.from("v_wetstock_daily").select("*").gte("day", since).order("day", { ascending: false }).order("tank_name")
      : empty,
  ]);

  const tanks = rows<TankStatus>(tanksResult, "tanks");
  const activeTanks = tanks.filter((t) => t.is_active);
  const dips = rows<TankDip>(dipsResult, "dips");
  const deliveries = rows<FuelDelivery>(deliveriesResult, "deliveries");
  const wetstock = rows<WetstockDay>(wetstockResult, "wet-stock reconciliation");
  const tankName = new Map(tanks.map((t) => [t.id, t.tank_name]));
  const tolerance = Number(settings.dip_variance_tolerance_percent);

  // Only the most recent closing dip per tank can be deleted.
  const latestClosing = new Map<string, string>();
  for (const dip of dips) {
    if (dip.dip_type === "CLOSING" && !latestClosing.has(dip.tank_id)) latestClosing.set(dip.tank_id, dip.id);
  }

  return (
    <>
      <PageHeader
        title="Tanks"
        description="Wet stock: book levels, physical dips and deliveries."
        actions={<RealtimeRefresh channel="tanks" tables={["tanks", "tank_dips", "fuel_deliveries"]} />}
      />

      <div className="flex flex-col gap-5">
        {activeTanks.length === 0 ? (
          <EmptyState>
            No tanks yet.{" "}
            {manager ? (
              <Link href="/settings" className="underline">
                Add your tanks in Settings.
              </Link>
            ) : (
              "Ask a manager to add the station's tanks."
            )}
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {activeTanks.map((tank) => (
              <TankMeter key={tank.id} tank={tank} />
            ))}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card
            title="Record a dip"
            description={
              closingDips
                ? "A closing dip resets book stock to the physical level and posts any gain or loss. Record it after the day's last meter readings."
                : "Record the opening dip at the start of the day. A manager records closing dips, which show any losses."
            }
          >
            <ActionForm action={recordDip} className="grid gap-4 sm:grid-cols-2">
              <Field label="Tank" htmlFor="dip_tank">
                <select id="dip_tank" name="tank_id" required className={inputClass}>
                  {activeTanks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.tank_name} ({t.fuel_type}) · book {formatLiters(t.current_volume, 0)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Dip" htmlFor="dip_type">
                <select id="dip_type" name="dip_type" defaultValue={manager ? "CLOSING" : "OPENING"} className={inputClass}>
                  <option value="OPENING">Opening dip (start of day)</option>
                  {closingDips && <option value="CLOSING">Closing dip (end of day)</option>}
                </select>
              </Field>
              <Field label="Date" htmlFor="dip_date">
                <input
                  id="dip_date"
                  name="dip_date"
                  type="date"
                  defaultValue={todayISO()}
                  {...(manager ? {} : attendantDateLimits(settings.attendant_date_window_days))}
                  className={inputClass}
                />
              </Field>
              <Field label="Volume (litres)" htmlFor="volume_liters" hint="From the tank's calibration chart.">
                <input id="volume_liters" name="volume_liters" inputMode="decimal" required className={inputClass} />
              </Field>
              <Field label="Stick reading (cm)" htmlFor="dip_reading_cm" hint="Optional.">
                <input id="dip_reading_cm" name="dip_reading_cm" inputMode="decimal" className={inputClass} />
              </Field>
              <Field label="Notes" htmlFor="dip_notes">
                <input id="dip_notes" name="notes" className={inputClass} />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton>Save dip</SubmitButton>
              </div>
            </ActionForm>
          </Card>

          {manager && (
            <Card
              title="Record a delivery"
              description="Received litres go into the tank; the waybill amount sets the cost and the supplier balance."
            >
              <ActionForm action={recordDelivery} className="grid gap-4 sm:grid-cols-2">
                <Field label="Tank" htmlFor="delivery_tank">
                  <select id="delivery_tank" name="tank_id" required className={inputClass}>
                    {activeTanks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.tank_name} ({t.fuel_type}) · space {formatLiters(t.ullage_liters, 0)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Date" htmlFor="delivery_date">
                  <input id="delivery_date" name="delivery_date" type="date" defaultValue={todayISO()} className={inputClass} />
                </Field>
                <Field label="Supplier" htmlFor="supplier">
                  <input id="supplier" name="supplier" required className={inputClass} />
                </Field>
                <Field label="Waybill number" htmlFor="waybill_number">
                  <input id="waybill_number" name="waybill_number" className={inputClass} />
                </Field>
                <Field label="Waybill litres" htmlFor="invoiced_liters" hint="What the supplier bills.">
                  <input id="invoiced_liters" name="invoiced_liters" inputMode="decimal" required className={inputClass} />
                </Field>
                <Field label="Litres received" htmlFor="received_liters" hint="Measured by dips before and after offloading.">
                  <input id="received_liters" name="received_liters" inputMode="decimal" required className={inputClass} />
                </Field>
                <Field label={`Cost per litre (${currency})`} htmlFor="unit_cost">
                  <input id="unit_cost" name="unit_cost" inputMode="decimal" required className={inputClass} />
                </Field>
                <Field label="Payment" htmlFor="delivery_payment">
                  <select id="delivery_payment" name="payment_method" defaultValue="CREDIT" className={inputClass}>
                    <option value="CREDIT">On credit (pay supplier later)</option>
                    <option value="CASH">Paid in cash</option>
                    <option value="BANK">Paid by bank / mobile money</option>
                  </select>
                </Field>
                <Field label="Notes" htmlFor="delivery_notes" className="sm:col-span-2">
                  <input id="delivery_notes" name="notes" className={inputClass} />
                </Field>
                <div className="sm:col-span-2">
                  <SubmitButton>Save delivery</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          )}
        </div>

        {manager && (
          <Card
            title="Wet-stock reconciliation"
            description={`Opening stock + deliveries − meter sales = expected closing, compared with the closing dip. Variance beyond ${formatPercent(tolerance, 2)} of sales is flagged.`}
          >
            {wetstock.length === 0 ? (
              <EmptyState>No stock movements in the last 14 days.</EmptyState>
            ) : (
              <TableWrap>
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Day</th>
                      <th className={thClass}>Tank</th>
                      <th className={`${thClass} ${numClass}`}>Opening</th>
                      <th className={`${thClass} ${numClass}`}>+ Deliveries</th>
                      <th className={`${thClass} ${numClass}`}>− Meter sales</th>
                      <th className={`${thClass} ${numClass}`}>= Expected</th>
                      <th className={`${thClass} ${numClass}`}>Closing dip</th>
                      <th className={`${thClass} ${numClass}`}>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wetstock.map((d) => {
                      const pct = d.variance_percent_of_sales === null ? null : Number(d.variance_percent_of_sales);
                      const flagged = pct !== null && Math.abs(pct) > tolerance;
                      return (
                        <tr key={`${d.tank_id}-${d.day}`}>
                          <td className={tdClass}>{formatDate(d.day)}</td>
                          <td className={tdClass}>
                            {d.tank_name} <span className="text-zinc-400">{d.fuel_type}</span>
                          </td>
                          <td className={`${tdClass} ${numClass}`}>
                            {d.opening_stock === null ? "—" : formatNumber(d.opening_stock, 0)}
                            {d.opening_source === "PREVIOUS_CLOSING_DIP" && (
                              <span className="block text-[11px] text-zinc-400">prev. closing</span>
                            )}
                          </td>
                          <td className={`${tdClass} ${numClass}`}>{formatNumber(d.deliveries_liters, 0)}</td>
                          <td className={`${tdClass} ${numClass}`}>{formatNumber(d.meter_sales_liters, 0)}</td>
                          <td className={`${tdClass} ${numClass}`}>
                            {d.expected_closing === null ? "—" : formatNumber(d.expected_closing, 0)}
                          </td>
                          <td className={`${tdClass} ${numClass}`}>
                            {d.closing_dip === null ? "—" : formatNumber(d.closing_dip, 0)}
                          </td>
                          <td className={`${tdClass} ${numClass}`}>
                            {d.variance_liters === null ? (
                              "—"
                            ) : (
                              <span className="inline-flex items-center justify-end gap-2">
                                <span>
                                  {formatNumber(d.variance_liters, 1)} L
                                  {pct !== null && (
                                    <span className="block text-[11px] text-zinc-400">{formatPercent(pct, 2)}</span>
                                  )}
                                </span>
                                {flagged && (
                                  <StatusBadge tone={Number(d.variance_liters) < 0 ? "critical" : "warning"}>
                                    {Number(d.variance_liters) < 0 ? "Loss" : "Gain"}
                                  </StatusBadge>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        )}

        <Card title="Recent dips" description="Last 14 days.">
          {dips.length === 0 ? (
            <EmptyState>No dips recorded in the last 14 days.</EmptyState>
          ) : (
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Day</th>
                    <th className={thClass}>Tank</th>
                    <th className={thClass}>Dip</th>
                    <th className={`${thClass} ${numClass}`}>Physical</th>
                    <th className={`${thClass} ${numClass}`}>Book</th>
                    <th className={`${thClass} ${numClass}`}>Difference</th>
                    {manager && <th className={thClass}><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {dips.map((dip) => (
                    <tr key={dip.id}>
                      <td className={tdClass}>{formatDate(dip.dip_date)}</td>
                      <td className={tdClass}>{tankName.get(dip.tank_id)}</td>
                      <td className={tdClass}>{dip.dip_type === "OPENING" ? "Opening" : "Closing"}</td>
                      <td className={`${tdClass} ${numClass}`}>{formatLiters(dip.volume_liters, 0)}</td>
                      <td className={`${tdClass} ${numClass}`}>
                        {dip.book_volume === null ? "—" : formatLiters(dip.book_volume, 0)}
                      </td>
                      <td className={`${tdClass} ${numClass}`}>
                        {dip.variance_liters === null ? "—" : formatLiters(dip.variance_liters, 1)}
                      </td>
                      {manager && (
                        <td className={`${tdClass} text-right`}>
                          {(dip.dip_type === "OPENING" || latestClosing.get(dip.tank_id) === dip.id) && (
                            <DeleteButton
                              action={deleteDip.bind(null, dip.id)}
                              confirm={
                                dip.dip_type === "CLOSING"
                                  ? "Delete this closing dip? Book stock goes back to what it would have been and the gain/loss posting is reversed."
                                  : "Delete this opening dip?"
                              }
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        {manager && (
          <Card title="Recent deliveries" description="Last 60 days.">
            {deliveries.length === 0 ? (
              <EmptyState>No deliveries in the last 60 days.</EmptyState>
            ) : (
              <TableWrap>
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Day</th>
                      <th className={thClass}>Tank</th>
                      <th className={thClass}>Supplier</th>
                      <th className={`${thClass} ${numClass}`}>Waybill</th>
                      <th className={`${thClass} ${numClass}`}>Received</th>
                      <th className={`${thClass} ${numClass}`}>Transit loss</th>
                      <th className={`${thClass} ${numClass}`}>Cost</th>
                      <th className={thClass}>Payment</th>
                      <th className={thClass}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((d) => (
                      <tr key={d.id}>
                        <td className={tdClass}>{formatDate(d.delivery_date)}</td>
                        <td className={tdClass}>{tankName.get(d.tank_id)}</td>
                        <td className={tdClass}>
                          {d.supplier}
                          {d.waybill_number && <span className="block text-xs text-zinc-400">#{d.waybill_number}</span>}
                        </td>
                        <td className={`${tdClass} ${numClass}`}>{formatLiters(d.invoiced_liters, 0)}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatLiters(d.received_liters, 0)}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatLiters(d.transit_loss_liters, 0)}</td>
                        <td className={`${tdClass} ${numClass}`}>
                          {formatMoney(d.total_cost, currency)}
                          <span className="block text-xs text-zinc-400">
                            {formatNumber(d.unit_cost, 2)} / L
                          </span>
                        </td>
                        <td className={tdClass}>{PAYMENT_LABELS[d.payment_method]}</td>
                        <td className={`${tdClass} text-right`}>
                          <DeleteButton
                            action={deleteDelivery.bind(null, d.id)}
                            confirm="Delete this delivery? The litres come out of the tank and the supplier posting is reversed."
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
