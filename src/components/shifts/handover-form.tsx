"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/actions";
import { formatMoney, formatSignedMoney } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonSecondary, inputClass } from "@/components/ui/styles";

const FIELDS = [
  { name: "cash_on_hand", label: "Cash on hand", hint: "Notes and coins counted at handover." },
  { name: "credit_slips_amount", label: "Credit slips", hint: "Fuel given on account to credit customers." },
  {
    name: "digital_transfers_amount",
    label: "Bank / mobile money",
    hint: "Card, bank transfer and mobile money receipts.",
  },
] as const;

type FieldName = (typeof FIELDS)[number]["name"];

export function HandoverForm({
  initial,
  notes,
  expectedSales,
  currency,
  tolerance,
  mode,
  action,
}: {
  initial: Record<FieldName, number>;
  notes: string | null;
  expectedSales: number;
  currency: string;
  tolerance: number;
  /** "attendant" can save a draft or submit; "correction" lets a manager amend a submitted shift. */
  mode: "attendant" | "correction";
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [values, setValues] = useState<Record<FieldName, string>>({
    cash_on_hand: initial.cash_on_hand ? String(initial.cash_on_hand) : "",
    credit_slips_amount: initial.credit_slips_amount ? String(initial.credit_slips_amount) : "",
    digital_transfers_amount: initial.digital_transfers_amount ? String(initial.digital_transfers_amount) : "",
  });

  const collected = FIELDS.reduce((sum, f) => sum + (Number(values[f.name].replace(/,/g, "")) || 0), 0);
  const variance = Math.round((collected - expectedSales) * 100) / 100;

  return (
    <ActionForm action={action} resetOnSuccess={false} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <Field key={f.name} label={f.label} htmlFor={f.name} hint={f.hint}>
            <input
              id={f.name}
              name={f.name}
              inputMode="decimal"
              placeholder="0"
              value={values[f.name]}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
              className={`${inputClass} tabular-nums`}
            />
          </Field>
        ))}
      </div>

      <Field label="Notes" htmlFor="notes" hint="Explain any shortage, pump issue or credit customer.">
        <textarea id="notes" name="notes" rows={2} defaultValue={notes ?? ""} className={inputClass} />
      </Field>

      <dl className="grid grid-cols-1 gap-3 rounded-lg bg-zinc-50 p-4 text-sm dark:bg-zinc-900 sm:grid-cols-3">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Expected (pump meters)</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {formatMoney(expectedSales, currency)}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Collected</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {formatMoney(collected, currency)}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Difference</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2 font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {formatSignedMoney(variance, currency)}
            {variance < -tolerance ? (
              <StatusBadge tone="critical">Short</StatusBadge>
            ) : variance > 0 ? (
              <StatusBadge tone="warning">Over</StatusBadge>
            ) : (
              <StatusBadge tone="good">Balanced</StatusBadge>
            )}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-3">
        {mode === "attendant" ? (
          <>
            <SubmitButton
              name="intent"
              value="submit"
              confirm="Hand over this shift? Meter readings will be locked for review."
            >
              Submit handover
            </SubmitButton>
            <SubmitButton name="intent" value="save" className={buttonSecondary}>
              Save draft
            </SubmitButton>
          </>
        ) : (
          <SubmitButton name="intent" value="save" className={buttonSecondary}>
            Save corrections
          </SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}
