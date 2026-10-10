import {
  addDispenser,
  addFuelProduct,
  addPump,
  addTank,
  correctMeter,
  removeDispenser,
  removeFuelProduct,
  removePump,
  removeTank,
  renameDispenser,
  restorePump,
  restoreTank,
  updateFuelProduct,
  updatePump,
  updateTank,
} from "@/app/(app)/settings/actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { EmptyState } from "@/components/ui/card";
import { DeleteButton } from "@/components/ui/delete-button";
import { Field } from "@/components/ui/field";
import { buttonSecondary, buttonSmall, inputClass } from "@/components/ui/styles";
import type { ActionState } from "@/lib/actions";
import { rows } from "@/lib/data";
import { formatDate, formatDateTime, formatLiters, formatMoney, formatNumber } from "@/lib/format";
import type { Supabase } from "@/lib/supabase/server";
import type { Dispenser, FuelProduct, Pump, TankStatus } from "@/lib/types";

const rowForm = "grid items-end gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800";

/** "Pump 2" before "Pump 10". */
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export interface Equipment {
  products: FuelProduct[];
  /** Every tank, retired ones included: their history still refers to them. */
  tanks: TankStatus[];
  dispensers: Dispenser[];
  /** Every nozzle, retired ones included. */
  pumps: Pump[];
  /** Unused tanks and nozzles, whose stock, fuel, name and meter can still be corrected. */
  inSetup: Set<string>;
  priceHistory: { id: string; fuel_type: string; old_price: number | null; new_price: number; changed_at: string }[];
}

export async function loadEquipment(supabase: Supabase): Promise<Equipment> {
  const [productsResult, tanksResult, dispensersResult, pumpsResult, setupResult, historyResult] = await Promise.all([
    supabase.from("fuel_products").select("*").order("code"),
    supabase.from("v_tank_status").select("*").order("tank_name"),
    supabase.from("dispensers").select("*"),
    supabase.from("pumps").select("*"),
    supabase.from("v_equipment_setup").select("id, in_setup"),
    supabase.from("fuel_price_history").select("*").order("changed_at", { ascending: false }).limit(10),
  ]);
  return {
    products: rows<FuelProduct>(productsResult, "fuel products"),
    tanks: rows<TankStatus>(tanksResult, "tanks").sort((a, b) => byName(a.tank_name, b.tank_name)),
    dispensers: rows<Dispenser>(dispensersResult, "pumps").sort((a, b) => byName(a.name, b.name)),
    pumps: rows<Pump>(pumpsResult, "nozzles").sort((a, b) => byName(a.pump_number, b.pump_number)),
    inSetup: new Set(
      rows<{ id: string; in_setup: boolean }>(setupResult, "equipment").filter((e) => e.in_setup).map((e) => e.id),
    ),
    priceHistory: rows<Equipment["priceHistory"][number]>(historyResult, "price history"),
  };
}

export function FuelPricesSection({ equipment, currency }: { equipment: Equipment; currency: string }) {
  const { products, tanks, priceHistory } = equipment;
  const inTanks = new Set(tanks.map((t) => t.fuel_type));

  return (
    <>
      <div className="flex flex-col gap-3">
        {products.length === 0 && <EmptyState>No fuels yet.</EmptyState>}
        {products.map((p) => (
          <div key={p.code} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <ActionForm
              action={updateFuelProduct.bind(null, p.code)}
              resetOnSuccess={false}
              className="grid items-end gap-3 sm:grid-cols-[5rem_1fr_10rem_10rem_auto]"
            >
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Code</p>
                <p className="py-2 font-semibold text-zinc-900 dark:text-zinc-50">{p.code}</p>
              </div>
              <Field label="Name" htmlFor={`name-${p.code}`}>
                <input id={`name-${p.code}`} name="name" defaultValue={p.name} className={inputClass} />
              </Field>
              <Field label="Pump price / L" htmlFor={`price-${p.code}`}>
                <input id={`price-${p.code}`} name="price_per_liter" inputMode="decimal" defaultValue={p.price_per_liter} className={inputClass} />
              </Field>
              <Field label="Average cost / L" htmlFor={`cost-${p.code}`}>
                <input id={`cost-${p.code}`} name="avg_cost_per_liter" inputMode="decimal" defaultValue={p.avg_cost_per_liter} className={inputClass} />
              </Field>
              <SubmitButton className={buttonSecondary}>Save</SubmitButton>
            </ActionForm>
            {!inTanks.has(p.code) && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">No tank holds {p.code}. Remove it if you don&apos;t sell it.</p>
                <DeleteButton action={removeFuelProduct.bind(null, p.code)} label="Remove" confirm={`Remove ${p.code}?`} />
              </div>
            )}
          </div>
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

      {priceHistory.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
            Recent price changes
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-zinc-600 dark:text-zinc-300">
            {priceHistory.map((h) => (
              <li key={h.id}>
                {formatDateTime(h.changed_at)} · {h.fuel_type}:{" "}
                {h.old_price === null ? "—" : formatMoney(h.old_price, currency)} → {formatMoney(h.new_price, currency)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export function TanksSection({ equipment, currency }: { equipment: Equipment; currency: string }) {
  const { products, inSetup } = equipment;
  const tanks = equipment.tanks.filter((t) => !t.retired_at);
  const retired = equipment.tanks.filter((t) => t.retired_at);

  return (
    <>
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
                <DeleteButton
                  action={removeTank.bind(null, t.id)}
                  label="Remove"
                  confirm={
                    setup
                      ? `Delete ${t.tank_name}? Its opening stock comes out of the books.`
                      : `Remove ${t.tank_name}? It has readings, dips or deliveries, so it is retired rather than deleted: its history stays in the records and it leaves daily use. ` +
                        `It still holds ${formatLiters(t.current_volume, 0)} in the books; if it is empty, record a closing dip of 0 first. ` +
                        `Nozzles drawing from it must be moved or removed first.`
                  }
                />
              </div>
            </div>
          );
        })}
      </div>

      <details className="mt-4" open={tanks.length === 0}>
        <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">Add a tank</summary>
        {products.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Add the fuels you sell first.</p>
        ) : (
          <ActionForm action={addTank} className={`${rowForm} mt-3 sm:grid-cols-2 lg:grid-cols-[1fr_8rem_9rem_9rem_9rem_auto]`}>
            <Field label="Tank name" htmlFor="tank_name">
              <input id="tank_name" name="tank_name" required placeholder={`Tank ${tanks.length + 1}`} className={inputClass} />
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
            <Field label="Reorder level (L)" htmlFor="reorder_level_liters" hint="Order more below this.">
              <input id="reorder_level_liters" name="reorder_level_liters" inputMode="decimal" required className={inputClass} />
            </Field>
            <SubmitButton className={buttonSecondary}>Add tank</SubmitButton>
          </ActionForm>
        )}
      </details>

      {retired.length > 0 && (
        <RemovedList
          title={`Removed tanks (${retired.length})`}
          items={retired.map((t) => ({
            id: t.id,
            name: `${t.tank_name} (${t.fuel_type})`,
            detail: `removed ${formatDate(t.retired_at)} · ${formatLiters(t.current_volume, 0)} in the books`,
            restore: restoreTank.bind(null, t.id),
          }))}
        />
      )}
    </>
  );
}

/**
 * Pumps and the nozzles on them. Each nozzle has its own meter and draws from
 * one tank; nozzles from before pumps were recorded are listed on their own.
 */
export function PumpsSection({ equipment, owner }: { equipment: Equipment; owner: boolean }) {
  const { dispensers, inSetup } = equipment;
  const tanks = equipment.tanks.filter((t) => !t.retired_at);
  const nozzles = equipment.pumps.filter((p) => !p.retired_at);
  const retired = equipment.pumps.filter((p) => p.retired_at);
  const pumpIds = new Set(dispensers.map((d) => d.id));
  const unassigned = nozzles.filter((p) => !p.dispenser_id || !pumpIds.has(p.dispenser_id));
  const tankLabel = new Map(equipment.tanks.map((t) => [t.id, `${t.tank_name} (${t.fuel_type})`]));

  if (tanks.length === 0 && nozzles.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Add a tank first: every nozzle draws from one.</p>;
  }

  const row = (pump: Pump) => (
    <NozzleRow
      key={pump.id}
      pump={pump}
      setup={inSetup.has(pump.id)}
      tanks={tanks}
      dispensers={dispensers}
      tankLabel={tankLabel.get(pump.tank_id) ?? "—"}
      owner={owner}
    />
  );

  return (
    <>
      <div className="flex flex-col gap-4">
        {dispensers.length === 0 && unassigned.length === 0 && (
          <EmptyState>No pumps yet. Add your first pump below, then its nozzles.</EmptyState>
        )}
        {dispensers.map((d, index) => {
          const own = nozzles.filter((p) => p.dispenser_id === d.id);
          return (
            <section key={d.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <ActionForm
                  action={renameDispenser.bind(null, d.id)}
                  resetOnSuccess={false}
                  className="flex flex-wrap items-center gap-2"
                >
                  <label htmlFor={`pump-name-${d.id}`} className="sr-only">
                    Pump name
                  </label>
                  <input
                    id={`pump-name-${d.id}`}
                    name="name"
                    defaultValue={d.name}
                    required
                    maxLength={30}
                    className={`${inputClass} w-44 font-semibold`}
                  />
                  <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Rename</SubmitButton>
                </ActionForm>
                <DeleteButton
                  action={removeDispenser.bind(null, d.id)}
                  label="Remove pump"
                  confirm={
                    own.length
                      ? `Remove ${d.name} and its ${own.length} nozzle${own.length === 1 ? "" : "s"}? Nozzles never used are deleted; nozzles with readings are retired, and their readings stay in the records.`
                      : `Remove ${d.name}?`
                  }
                />
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {own.length === 0 ? "No nozzles yet." : `${own.length} nozzle${own.length === 1 ? "" : "s"}`}
              </p>
              {own.length > 0 && <div className="mt-3 flex flex-col gap-2">{own.map(row)}</div>}
              {tanks.length > 0 && (
                <AddNozzleForm
                  dispenserId={d.id}
                  tanks={tanks}
                  suggested={`${index + 1}${String.fromCharCode(65 + own.length)}`}
                  open={own.length === 0}
                />
              )}
            </section>
          );
        })}

        {unassigned.length > 0 && (
          <section className="rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Nozzles not on a pump</h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {dispensers.length
                ? "Choose the pump each one is on, then save."
                : "Add your pumps below, then choose the pump each nozzle is on."}
            </p>
            <div className="mt-3 flex flex-col gap-2">{unassigned.map(row)}</div>
          </section>
        )}
      </div>

      <details className="mt-4" open={dispensers.length === 0}>
        <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">Add a pump</summary>
        <ActionForm action={addDispenser} className={`${rowForm} mt-3 sm:grid-cols-[1fr_auto]`}>
          <Field label="Pump name" htmlFor="new_pump_name" hint="e.g. Pump 1 or Island A. Add its nozzles after.">
            <input
              id="new_pump_name"
              name="name"
              required
              maxLength={30}
              placeholder={`Pump ${dispensers.length + 1}`}
              className={inputClass}
            />
          </Field>
          <SubmitButton className={buttonSecondary}>Add pump</SubmitButton>
        </ActionForm>
      </details>

      {retired.length > 0 && (
        <RemovedList
          title={`Removed nozzles (${retired.length})`}
          items={retired.map((p) => ({
            id: p.id,
            name: p.pump_number,
            detail: `${tankLabel.get(p.tank_id) ?? "—"} · removed ${formatDate(p.retired_at)} · meter ${formatNumber(p.current_meter, 2)}`,
            restore: restorePump.bind(null, p.id),
          }))}
        />
      )}
    </>
  );
}

function NozzleRow({
  pump,
  setup,
  tanks,
  dispensers,
  tankLabel,
  owner,
}: {
  pump: Pump;
  /** No readings yet, so name, tank and meter can still change. */
  setup: boolean;
  tanks: TankStatus[];
  dispensers: Dispenser[];
  tankLabel: string;
  owner: boolean;
}) {
  return (
    <div className="rounded-md border border-zinc-100 p-3 dark:border-zinc-900">
      <ActionForm
        action={updatePump.bind(null, pump.id)}
        resetOnSuccess={false}
        className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[9rem_1fr_9rem_9rem_6rem_auto]"
      >
        {setup ? (
          <>
            <Field label="Nozzle" htmlFor={`nozzle-${pump.id}`}>
              <input id={`nozzle-${pump.id}`} name="pump_number" defaultValue={pump.pump_number} maxLength={30} className={inputClass} />
            </Field>
            <Field label="Draws from" htmlFor={`nozzle-tank-${pump.id}`}>
              <select id={`nozzle-tank-${pump.id}`} name="tank_id" defaultValue={pump.tank_id} className={inputClass}>
                {tanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tank_name} ({t.fuel_type})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Meter" htmlFor={`meter-${pump.id}`}>
              <input id={`meter-${pump.id}`} name="current_meter" inputMode="decimal" defaultValue={pump.current_meter} className={inputClass} />
            </Field>
          </>
        ) : (
          <>
            <ReadOnlyField label="Nozzle" value={pump.pump_number} />
            <ReadOnlyField label="Draws from" value={tankLabel} />
            <ReadOnlyField label="Meter" value={formatNumber(pump.current_meter, 2)} />
          </>
        )}
        <Field label="On pump" htmlFor={`nozzle-pump-${pump.id}`}>
          <select id={`nozzle-pump-${pump.id}`} name="dispenser_id" defaultValue={pump.dispenser_id ?? ""} className={inputClass}>
            <option value="">Not on a pump</option>
            {dispensers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 py-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" name="is_active" defaultChecked={pump.is_active} /> In use
        </label>
        <SubmitButton className={buttonSecondary}>Save</SubmitButton>
      </ActionForm>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {setup
            ? "No readings yet, so the name, tank and meter can still be corrected."
            : "Has readings, so its name and tank are fixed. The next shift opens at this meter."}
        </p>
        <div className="flex flex-wrap items-start justify-end gap-2">
          {!setup && owner && (
            <details>
              <summary className={`${buttonSecondary} ${buttonSmall} cursor-pointer list-none`}>Correct meter</summary>
              <ActionForm action={correctMeter.bind(null, pump.id)} className="mt-2 grid gap-2 sm:grid-cols-[9rem_14rem_auto] sm:items-end">
                <Field label="New meter" htmlFor={`correct-${pump.id}`}>
                  <input id={`correct-${pump.id}`} name="new_meter" inputMode="decimal" required className={inputClass} />
                </Field>
                <Field label="Reason" htmlFor={`reason-${pump.id}`}>
                  <input id={`reason-${pump.id}`} name="reason" required placeholder="e.g. meter replaced" className={inputClass} />
                </Field>
                <SubmitButton className={buttonSecondary}>Correct</SubmitButton>
              </ActionForm>
            </details>
          )}
          <DeleteButton
            action={removePump.bind(null, pump.id)}
            label="Remove"
            confirm={
              setup
                ? `Delete nozzle ${pump.pump_number}?`
                : `Remove nozzle ${pump.pump_number}? It has meter readings, so it is retired rather than deleted: its readings stay in the records and it no longer appears for new shifts. You can restore it later.`
            }
          />
        </div>
      </div>
    </div>
  );
}

function AddNozzleForm({
  dispenserId,
  tanks,
  suggested,
  open,
}: {
  dispenserId: string;
  tanks: TankStatus[];
  suggested: string;
  open: boolean;
}) {
  const active = tanks.filter((t) => t.is_active);
  return (
    <details className="mt-3" open={open}>
      <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">Add a nozzle</summary>
      <ActionForm
        action={addPump}
        className="mt-2 grid items-end gap-3 rounded-md border border-zinc-100 p-3 dark:border-zinc-900 sm:grid-cols-2 lg:grid-cols-[9rem_1fr_10rem_auto]"
      >
        <input type="hidden" name="dispenser_id" value={dispenserId} />
        <Field label="Nozzle name" htmlFor={`new-nozzle-${dispenserId}`} hint={`Any name, e.g. ${suggested}.`}>
          <input
            id={`new-nozzle-${dispenserId}`}
            name="pump_number"
            required
            maxLength={30}
            placeholder={suggested}
            className={inputClass}
          />
        </Field>
        <Field label="Draws from" htmlFor={`new-nozzle-tank-${dispenserId}`}>
          <select id={`new-nozzle-tank-${dispenserId}`} name="tank_id" className={inputClass}>
            {active.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tank_name} ({t.fuel_type})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Meter now" htmlFor={`new-nozzle-meter-${dispenserId}`} hint="The totaliser reading.">
          <input
            id={`new-nozzle-meter-${dispenserId}`}
            name="current_meter"
            inputMode="decimal"
            defaultValue={0}
            className={inputClass}
          />
        </Field>
        <SubmitButton className={buttonSecondary}>Add nozzle</SubmitButton>
      </ActionForm>
    </details>
  );
}

/** Retired equipment: out of use, kept for its history, and restorable. */
function RemovedList({
  title,
  items,
}: {
  title: string;
  items: { id: string; name: string; detail: string; restore: (state: ActionState, form: FormData) => Promise<ActionState> }[];
}) {
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
        {title}
      </summary>
      <ul className="mt-2 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{item.name}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{item.detail}</span>
            </span>
            <ActionForm action={item.restore} showSuccess={false} className="flex flex-col items-end gap-1">
              <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Restore</SubmitButton>
            </ActionForm>
          </li>
        ))}
      </ul>
    </details>
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
