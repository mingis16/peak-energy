import { saveFuelSetup } from "@/app/setup/actions";
import { NextStep } from "@/components/settings/next-step";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { inputClass } from "@/components/ui/styles";
import type { FuelProduct } from "@/lib/types";

const row = "grid items-end gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-[6rem_1fr_9rem_9rem]";

/** Every fuel on one form, so nothing typed is lost moving to the next step. */
export function FuelSetupForm({ products, currency, next }: { products: FuelProduct[]; currency: string; next: string }) {
  return (
    <ActionForm action={saveFuelSetup} resetOnSuccess={false} className="flex flex-col gap-3">
      <NextStep next={next} />
      {products.map((p) => (
        <div key={p.code} className={row}>
          <input type="hidden" name="code" value={p.code} />
          <label className="flex items-center gap-2 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            <input type="checkbox" name={`sell_${p.code}`} defaultChecked /> {p.code}
          </label>
          <Field label="Name" htmlFor={`fuel-name-${p.code}`}>
            <input id={`fuel-name-${p.code}`} name={`name_${p.code}`} defaultValue={p.name} className={inputClass} />
          </Field>
          <Field label={`Pump price / L (${currency})`} htmlFor={`fuel-price-${p.code}`}>
            <input
              id={`fuel-price-${p.code}`}
              name={`price_${p.code}`}
              inputMode="decimal"
              defaultValue={p.price_per_liter}
              className={inputClass}
            />
          </Field>
          <Field label={`Cost / L (${currency})`} htmlFor={`fuel-cost-${p.code}`}>
            <input
              id={`fuel-cost-${p.code}`}
              name={`cost_${p.code}`}
              inputMode="decimal"
              defaultValue={p.avg_cost_per_liter}
              className={inputClass}
            />
          </Field>
        </div>
      ))}

      <details className="rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700" open={products.length === 0}>
        <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">Another fuel</summary>
        <div className="mt-3 grid items-end gap-3 sm:grid-cols-[6rem_1fr_9rem_9rem]">
          <Field label="Code" htmlFor="new_fuel_code">
            <input id="new_fuel_code" name="new_code" placeholder="LPG" maxLength={10} className={`${inputClass} uppercase`} />
          </Field>
          <Field label="Name" htmlFor="new_fuel_name">
            <input id="new_fuel_name" name="new_name" placeholder="Liquefied petroleum gas" className={inputClass} />
          </Field>
          <Field label={`Pump price / L (${currency})`} htmlFor="new_fuel_price">
            <input id="new_fuel_price" name="new_price" inputMode="decimal" defaultValue={0} className={inputClass} />
          </Field>
          <Field label={`Cost / L (${currency})`} htmlFor="new_fuel_cost">
            <input id="new_fuel_cost" name="new_cost" inputMode="decimal" defaultValue={0} className={inputClass} />
          </Field>
        </div>
      </details>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Untick the fuels you don&apos;t sell. The cost is what you paid per litre for the fuel in your tanks now; deliveries keep
        it up to date after that.
      </p>
      <div>
        <SubmitButton>Save and continue</SubmitButton>
      </div>
    </ActionForm>
  );
}
