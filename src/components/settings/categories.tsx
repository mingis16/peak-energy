import { addCategory, updateCategory } from "@/app/(app)/settings/actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { buttonSecondary, inputClass } from "@/components/ui/styles";
import type { Account, TransactionCategory } from "@/lib/types";

const GROUPS = [
  { type: "EXPENSE", title: "Money out" },
  { type: "INCOME", title: "Money in" },
] as const;

const ACCOUNT_GROUPS = [
  { label: "Operating expenses", match: (a: Account) => a.report_group === "OPEX" },
  { label: "Other income", match: (a: Account) => a.report_group === "OTHER_INCOME" },
  { label: "Not profit or loss (balances)", match: (a: Account) => a.report_group === null },
];

/** The cash book's categories: what each is called, and whether it is still used. */
export function CategoriesSection({ categories, accounts }: { categories: TransactionCategory[]; accounts: Account[] }) {
  const accountName = new Map(accounts.map((a) => [a.code, a.name]));

  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map((group) => (
        <section key={group.type}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{group.title}</h3>
          <div className="flex flex-col gap-2">
            {categories
              .filter((c) => c.transaction_type === group.type)
              .map((c) => (
                <ActionForm
                  key={c.name}
                  action={updateCategory.bind(null, c.name)}
                  resetOnSuccess={false}
                  className="grid items-center gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-[14rem_1fr_auto_auto]"
                >
                  <label htmlFor={`category-${c.name}`} className="sr-only">
                    Name
                  </label>
                  <input id={`category-${c.name}`} name="name" defaultValue={c.name} required className={inputClass} />
                  <label htmlFor={`category-description-${c.name}`} className="sr-only">
                    What it is for
                  </label>
                  <input
                    id={`category-description-${c.name}`}
                    name="description"
                    defaultValue={c.description ?? ""}
                    placeholder="What it is for"
                    className={inputClass}
                  />
                  <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="checkbox" name="is_active" defaultChecked={c.is_active} /> In use
                  </label>
                  <SubmitButton className={buttonSecondary}>Save</SubmitButton>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 sm:col-span-4">
                    Posts to {c.account_code} · {accountName.get(c.account_code) ?? "—"}
                  </p>
                </ActionForm>
              ))}
          </div>
        </section>
      ))}

      <details>
        <summary className="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">Add a category</summary>
        <ActionForm action={addCategory} className="mt-3 grid gap-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-2">
          <Field label="Name" htmlFor="new_category_name">
            <input id="new_category_name" name="name" required placeholder="e.g. Security guards" className={inputClass} />
          </Field>
          <Field label="Money in or out?" htmlFor="new_category_type">
            <select id="new_category_type" name="transaction_type" defaultValue="EXPENSE" className={inputClass}>
              <option value="EXPENSE">Money out</option>
              <option value="INCOME">Money in</option>
            </select>
          </Field>
          <Field label="What it is for" htmlFor="new_category_description">
            <input id="new_category_description" name="description" className={inputClass} />
          </Field>
          <Field
            label="Where it goes in the accounts"
            htmlFor="new_category_account"
            hint="Its own line puts it on the profit & loss as an expense or as other income."
          >
            <select id="new_category_account" name="account_code" defaultValue="" className={inputClass}>
              <option value="">Its own line on the profit &amp; loss</option>
              {ACCOUNT_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {accounts.filter(g.match).map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton>Add category</SubmitButton>
          </div>
        </ActionForm>
      </details>
    </div>
  );
}
