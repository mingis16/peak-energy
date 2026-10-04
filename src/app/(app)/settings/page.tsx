import type { Metadata } from "next";
import {
  addFuelProduct,
  addPump,
  addTank,
  correctMeter,
  removePump,
  removeTank,
  updateFuelProduct,
  updatePump,
  updateStaffRole,
  updateStation,
  updateTank,
} from "./actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { DeleteButton } from "@/components/ui/delete-button";
import { Field } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonSecondary, buttonSmall, inputClass } from "@/components/ui/styles";
import { getStationSettings, requireManager } from "@/lib/auth";
import { rows } from "@/lib/data";
import { formatDateTime, formatLiters, formatMoney, formatNumber } from "@/lib/format";
import type { FuelProduct, Profile, Pump, TankStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Settings" };

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "attendant", label: "Attendant" },
  { value: "pending", label: "No access (pending)" },
];

const rowForm = "grid items-end gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800";

export default async function SettingsPage() {
  const { supabase, profile } = await requireManager();
  const settings = await getStationSettings();
  const currency = settings.currency_code;
  const owner = profile.role === "owner";

  const [productsResult, tanksResult, pumpsResult, staffResult, historyResult, setupResult] = await Promise.all([
    supabase.from("fuel_products").select("*").order("code"),
    supabase.from("v_tank_status").select("*").order("tank_name"),
    supabase.from("pumps").select("*").order("pump_number"),
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("fuel_price_history").select("*").order("changed_at", { ascending: false }).limit(10),
    supabase.from("v_equipment_setup").select("id, in_setup"),
  ]);
  const products = rows<FuelProduct>(productsResult, "fuel products");
  const tanks = rows<TankStatus>(tanksResult, "tanks");
  const pumps = rows<Pump>(pumpsResult, "pumps");
  // Unused tanks and pumps, whose stock, fuel and meters can still be corrected.
  const inSetup = new Set(rows<{ id: string; in_setup: boolean }>(setupResult, "equipment").filter((e) => e.in_setup).map((e) => e.id));
  const staff = rows<Profile>(staffResult, "staff");
  const history = rows<{ id: string; fuel_type: string; old_price: number | null; new_price: number; changed_at: string }>(
    historyResult,
    "price history",
  );
  const pending = staff.filter((s) => s.role === "pending");

  return (
    <>
      <PageHeader title="Settings" description="Station setup: prices, tanks, pumps and staff." />

      <div className="flex flex-col gap-5">
        {owner && pending.length > 0 && (
          <p className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <StatusBadge tone="warning">{pending.length} waiting</StatusBadge>
            New staff accounts are waiting for a role. Assign one under Staff below.
          </p>
        )}

        <Card title="Station">
          <ActionForm action={updateStation} resetOnSuccess={false} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Station name" htmlFor="station_name">
              <input id="station_name" name="station_name" defaultValue={settings.station_name} required className={inputClass} />
            </Field>
            <Field label="Currency code" htmlFor="currency_code" hint="ISO code, e.g. SLE.">
              <input id="currency_code" name="currency_code" defaultValue={currency} required maxLength={3} className={inputClass} />
            </Field>
            <Field
              label="Shortage tolerance"
              htmlFor="shortage_tolerance"
              hint={owner ? "Shift shortages up to this amount are not flagged." : "Only the owner can change this."}
            >
              <input
                id="shortage_tolerance"
                name="shortage_tolerance"
                inputMode="decimal"
                defaultValue={settings.shortage_tolerance}
                readOnly={!owner}
                className={inputClass}
              />
            </Field>
            <Field
              label="Dip variance tolerance (%)"
              htmlFor="dip_variance_tolerance_percent"
              hint={owner ? "Of litres sold that day." : "Only the owner can change this."}
            >
              <input
                id="dip_variance_tolerance_percent"
                name="dip_variance_tolerance_percent"
                inputMode="decimal"
                defaultValue={settings.dip_variance_tolerance_percent}
                readOnly={!owner}
                className={inputClass}
              />
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton>Save station settings</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card
          title="Fuel prices"
          description="Pump price is what customers pay. Average cost is kept up to date by deliveries; set it by hand only for opening stock."
        >
          <div className="flex flex-col gap-3">
            {products.map((p) => (
              <ActionForm
                key={p.code}
                action={updateFuelProduct.bind(null, p.code)}
                resetOnSuccess={false}
                className={`${rowForm} sm:grid-cols-[5rem_1fr_10rem_10rem_auto]`}
              >
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Code</p>
                  <p className="py-2 font-semibold text-zinc-900 dark:text-zinc-50">{p.code}</p>
                </div>
                <Field label="Name" htmlFor={`name-${p.code}`}>
                  <input id={`name-${p.code}`} name="name" defaultValue={p.name} className={inputClass} />
                </Field>
                <Field label={`Pump price / L`} htmlFor={`price-${p.code}`}>
                  <input id={`price-${p.code}`} name="price_per_liter" inputMode="decimal" defaultValue={p.price_per_liter} className={inputClass} />
                </Field>
                <Field label="Average cost / L" htmlFor={`cost-${p.code}`}>
                  <input id={`cost-${p.code}`} name="avg_cost_per_liter" inputMode="decimal" defaultValue={p.avg_cost_per_liter} className={inputClass} />
                </Field>
                <SubmitButton className={buttonSecondary}>Save</SubmitButton>
              </ActionForm>
            ))}
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">Add a fuel</summary>
            <ActionForm action={addFuelProduct} className={`${rowForm} mt-3 sm:grid-cols-[6rem_1fr_10rem_10rem_auto]`}>
              <Field label="Code" htmlFor="new_code">
                <input id="new_code" name="code" required placeholder="LPG" className={inputClass} />
              </Field>
              <Field label="Name" htmlFor="new_name">
                <input id="new_name" name="name" required className={inputClass} />
              </Field>
              <Field label="Pump price / L" htmlFor="new_price">
                <input id="new_price" name="price_per_liter" inputMode="decimal" defaultValue={0} className={inputClass} />
              </Field>
              <Field label="Average cost / L" htmlFor="new_cost">
                <input id="new_cost" name="avg_cost_per_liter" inputMode="decimal" defaultValue={0} className={inputClass} />
              </Field>
              <SubmitButton className={buttonSecondary}>Add</SubmitButton>
            </ActionForm>
          </details>

          {history.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
                Recent price changes
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-zinc-600 dark:text-zinc-300">
                {history.map((h) => (
                  <li key={h.id}>
                    {formatDateTime(h.changed_at)} · {h.fuel_type}:{" "}
                    {h.old_price === null ? "—" : formatMoney(h.old_price, currency)} → {formatMoney(h.new_price, currency)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        <Card
          title="Tanks"
          description="Before a tank is used, set its fuel and the stock in it now (from a dip). After its first reading, dip or delivery, stock changes only through those."
        >
          <div className="flex flex-col gap-3">
            {tanks.length === 0 && <EmptyState>No tanks yet.</EmptyState>}
            {tanks.map((t) => {
              const setup = inSetup.has(t.id);
              return (
                <div key={t.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <ActionForm
                    action={updateTank.bind(null, t.id)}
                    resetOnSuccess={false}
                    className={`grid items-end gap-3 sm:grid-cols-2 ${
                      setup ? "lg:grid-cols-[1fr_7rem_8rem_8rem_8rem_6rem_auto]" : "lg:grid-cols-[1fr_6rem_9rem_9rem_7rem_auto]"
                    }`}
                  >
                    <Field label="Tank name" htmlFor={`tank-name-${t.id}`}>
                      <input id={`tank-name-${t.id}`} name="tank_name" defaultValue={t.tank_name} className={inputClass} />
                    </Field>
                    {setup ? (
                      <Field label="Fuel" htmlFor={`tank-fuel-${t.id}`}>
                        <select id={`tank-fuel-${t.id}`} name="fuel_type" defaultValue={t.fuel_type} className={inputClass}>
                          {products.map((p) => (
                            <option key={p.code} value={p.code}>
                              {p.code}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ) : (
                      <ReadOnlyField label="Fuel" value={t.fuel_type} />
                    )}
                    <Field label="Capacity (L)" htmlFor={`cap-${t.id}`}>
                      <input id={`cap-${t.id}`} name="capacity_liters" inputMode="decimal" defaultValue={t.capacity_liters} className={inputClass} />
                    </Field>
                    {setup && (
                      <Field label="Stock in tank (L)" htmlFor={`stock-${t.id}`}>
                        <input id={`stock-${t.id}`} name="current_volume" inputMode="decimal" defaultValue={t.current_volume} className={inputClass} />
                      </Field>
                    )}
                    <Field label="Reorder level (L)" htmlFor={`reorder-${t.id}`}>
                      <input id={`reorder-${t.id}`} name="reorder_level_liters" inputMode="decimal" defaultValue={t.reorder_level_liters} className={inputClass} />
                    </Field>
                    <label className="flex items-center gap-2 py-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input type="checkbox" name="is_active" defaultChecked={t.is_active} /> In use
                    </label>
                    <SubmitButton className={buttonSecondary}>Save</SubmitButton>
                  </ActionForm>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {setup
                        ? `Not used yet, so fuel and stock can still be corrected · valued at ${formatMoney(t.stock_value, currency)}`
                        : `Book stock ${formatLiters(t.current_volume, 0)} · valued at ${formatMoney(t.stock_value, currency)} · changes only through readings, dips and deliveries`}
                    </p>
                    {setup && (
                      <DeleteButton
                        action={removeTank.bind(null, t.id)}
                        label="Remove"
                        confirm={`Remove ${t.tank_name}? Its opening stock comes out of the books.`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <details className="mt-4" open={tanks.length === 0}>
            <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">Add a tank</summary>
            <ActionForm action={addTank} className={`${rowForm} mt-3 sm:grid-cols-2 lg:grid-cols-[1fr_8rem_9rem_9rem_9rem_auto]`}>
              <Field label="Tank name" htmlFor="tank_name">
                <input id="tank_name" name="tank_name" required placeholder="Tank 1" className={inputClass} />
              </Field>
              <Field label="Fuel" htmlFor="fuel_type">
                <select id="fuel_type" name="fuel_type" className={inputClass}>
                  {products.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.code}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Capacity (L)" htmlFor="capacity_liters">
                <input id="capacity_liters" name="capacity_liters" inputMode="decimal" required className={inputClass} />
              </Field>
              <Field label="Current volume (L)" htmlFor="current_volume" hint="From today's dip.">
                <input id="current_volume" name="current_volume" inputMode="decimal" defaultValue={0} className={inputClass} />
              </Field>
              <Field label="Reorder level (L)" htmlFor="reorder_level_liters">
                <input id="reorder_level_liters" name="reorder_level_liters" inputMode="decimal" required className={inputClass} />
              </Field>
              <SubmitButton className={buttonSecondary}>Add tank</SubmitButton>
            </ActionForm>
          </details>
        </Card>

        <Card
          title="Pumps"
          description="One row per metered nozzle. Before a pump's first reading, enter its real meter. After that, each shift opens where the last one closed, and only the owner can correct a meter."
        >
          <div className="flex flex-col gap-3">
            {pumps.length === 0 && <EmptyState>No pumps yet.</EmptyState>}
            {pumps.map((p) => {
              const setup = inSetup.has(p.id);
              const tank = tanks.find((t) => t.id === p.tank_id);
              return (
                <div key={p.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <ActionForm
                    action={updatePump.bind(null, p.id)}
                    resetOnSuccess={false}
                    className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[8rem_1fr_10rem_7rem_auto]"
                  >
                    {setup ? (
                      <>
                        <Field label="Pump" htmlFor={`pump-${p.id}`}>
                          <input id={`pump-${p.id}`} name="pump_number" defaultValue={p.pump_number} className={inputClass} />
                        </Field>
                        <Field label="Draws from" htmlFor={`pump-tank-${p.id}`}>
                          <select id={`pump-tank-${p.id}`} name="tank_id" defaultValue={p.tank_id} className={inputClass}>
                            {tanks.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.tank_name} ({t.fuel_type})
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Meter" htmlFor={`meter-${p.id}`}>
                          <input id={`meter-${p.id}`} name="current_meter" inputMode="decimal" defaultValue={p.current_meter} className={inputClass} />
                        </Field>
                      </>
                    ) : (
                      <>
                        <ReadOnlyField label="Pump" value={p.pump_number} />
                        <ReadOnlyField label="Draws from" value={tank ? `${tank.tank_name} (${tank.fuel_type})` : "—"} />
                        <ReadOnlyField label="Meter" value={formatNumber(p.current_meter, 2)} />
                      </>
                    )}
                    <label className="flex items-center gap-2 py-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input type="checkbox" name="is_active" defaultChecked={p.is_active} /> In use
                    </label>
                    <SubmitButton className={buttonSecondary}>Save</SubmitButton>
                  </ActionForm>
                  <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {setup
                        ? "No readings yet, so the number, tank and meter can still be corrected."
                        : "The next shift opens at this meter."}
                    </p>
                    {setup && (
                      <DeleteButton action={removePump.bind(null, p.id)} label="Remove" confirm={`Remove pump ${p.pump_number}?`} />
                    )}
                    {!setup && owner && (
                      <details className="w-full sm:w-auto">
                        <summary className={`${buttonSecondary} ${buttonSmall} cursor-pointer list-none`}>Correct meter</summary>
                        <ActionForm action={correctMeter.bind(null, p.id)} className="mt-2 grid gap-2 sm:grid-cols-[9rem_14rem_auto] sm:items-end">
                          <Field label="New meter" htmlFor={`correct-${p.id}`}>
                            <input id={`correct-${p.id}`} name="new_meter" inputMode="decimal" required className={inputClass} />
                          </Field>
                          <Field label="Reason" htmlFor={`reason-${p.id}`}>
                            <input id={`reason-${p.id}`} name="reason" required placeholder="e.g. meter replaced" className={inputClass} />
                          </Field>
                          <SubmitButton className={buttonSecondary}>Correct</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {tanks.length > 0 && (
            <details className="mt-4" open={pumps.length === 0}>
              <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">Add a pump</summary>
              <ActionForm action={addPump} className={`${rowForm} mt-3 sm:grid-cols-2 lg:grid-cols-[8rem_1fr_10rem_auto]`}>
                <Field label="Pump" htmlFor="pump_number">
                  <input id="pump_number" name="pump_number" required placeholder="P1" className={inputClass} />
                </Field>
                <Field label="Draws from" htmlFor="pump_tank">
                  <select id="pump_tank" name="tank_id" className={inputClass}>
                    {tanks.filter((t) => t.is_active).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.tank_name} ({t.fuel_type})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Current meter" htmlFor="current_meter">
                  <input id="current_meter" name="current_meter" inputMode="decimal" defaultValue={0} className={inputClass} />
                </Field>
                <SubmitButton className={buttonSecondary}>Add pump</SubmitButton>
              </ActionForm>
            </details>
          )}
        </Card>

        <Card
          title="Staff"
          description={
            owner
              ? "Attendants run shifts and record dips and bar sales. Managers also handle pricing, deliveries and accounts."
              : "Only the owner can change roles."
          }
        >
          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
            {staff.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {person.full_name || "—"}
                    {person.id === profile.id && <span className="text-zinc-400"> (you)</span>}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{person.email}</p>
                </div>
                {owner ? (
                  <ActionForm action={updateStaffRole.bind(null, person.id)} resetOnSuccess={false} className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`role-${person.id}`} className="sr-only">Role</label>
                    <select id={`role-${person.id}`} name="role" defaultValue={person.role} className={`${inputClass} w-auto`}>
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <SubmitButton className={buttonSecondary}>Save</SubmitButton>
                  </ActionForm>
                ) : (
                  <StatusBadge tone={person.role === "pending" ? "warning" : "neutral"}>
                    {ROLE_OPTIONS.find((r) => r.value === person.role)?.label}
                  </StatusBadge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</p>
      <p className="py-2 text-sm text-zinc-900 dark:text-zinc-50">{value}</p>
    </div>
  );
}
