"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { AlertTriangle } from "lucide-react";
import type { ActionState } from "@/lib/actions";
import { formatLiters, formatMoney, formatNumber } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { inputClass, numClass, tableClass, tdClass, thClass } from "@/components/ui/styles";

export interface ReadingRow {
  pumpId: string;
  /** The nozzle's name. */
  pumpNumber: string;
  /** The pump the nozzle is on, if one was recorded. */
  dispenserName: string | null;
  tankName: string;
  fuelType: string;
  price: number;
  /** Where the pump's last reading closed; the database fixes it, nobody types it. */
  opening: number;
  closing: number | null;
  saved: boolean;
}

function parse(value: string): number | null {
  const n = Number(value.replace(/,/g, ""));
  return value.trim() === "" || !Number.isFinite(n) ? null : n;
}

export function ReadingsForm({
  rows,
  currency,
  editable,
  action,
}: {
  rows: ReadingRow[];
  currency: string;
  editable: boolean;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [closings, setClosings] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.pumpId, r.closing === null ? "" : String(r.closing)])),
  );

  // Rows can change after a save (e.g. a pump added); fall back to the row's own value.
  const closingOf = (row: ReadingRow) => closings[row.pumpId] ?? (row.closing === null ? "" : String(row.closing));

  const computed = rows.map((row) => {
    const closing = parse(closingOf(row));
    const liters = closing !== null ? closing - row.opening : null;
    return {
      row,
      liters,
      amount: liters !== null && liters >= 0 ? Math.round(liters * row.price * 100) / 100 : null,
      invalid: liters !== null && liters < 0,
    };
  });
  const totalLiters = computed.reduce((sum, c) => sum + (c.liters && c.liters > 0 ? c.liters : 0), 0);
  const totalAmount = computed.reduce((sum, c) => sum + (c.amount ?? 0), 0);

  const table = (
    <div className="-mx-4 overflow-x-auto px-4 md:-mx-5 md:px-5">
      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Nozzle</th>
            <th className={`${thClass} ${numClass}`}>Price / L</th>
            <th className={`${thClass} ${numClass}`}>Opening</th>
            <th className={`${thClass} ${numClass}`}>Closing</th>
            <th className={`${thClass} ${numClass}`}>Litres</th>
            <th className={`${thClass} ${numClass}`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {computed.map(({ row, liters, amount, invalid }) => (
            <tr key={row.pumpId}>
              <td className={tdClass}>
                <p className="font-medium text-zinc-900 dark:text-zinc-50">{row.pumpNumber}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {row.dispenserName && <>{row.dispenserName} · </>}
                  {row.fuelType} · {row.tankName}
                </p>
              </td>
              <td className={`${tdClass} ${numClass}`}>{formatNumber(row.price, 2)}</td>
              <td className={`${tdClass} ${numClass}`}>{formatNumber(row.opening, 2)}</td>
              <td className={`${tdClass} ${numClass}`}>
                {editable ? (
                  <input
                    aria-label={`${row.pumpNumber} closing meter`}
                    name={`closing_${row.pumpId}`}
                    inputMode="decimal"
                    placeholder="—"
                    value={closingOf(row)}
                    onChange={(e) => setClosings((prev) => ({ ...prev, [row.pumpId]: e.target.value }))}
                    aria-invalid={invalid}
                    className={clsx(
                      inputClass,
                      "w-28 text-right tabular-nums",
                      invalid && "border-critical focus:border-critical",
                    )}
                  />
                ) : row.closing === null ? (
                  "—"
                ) : (
                  formatNumber(row.closing, 2)
                )}
              </td>
              <td className={`${tdClass} ${numClass}`}>
                {invalid ? (
                  <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                    <AlertTriangle aria-hidden className="h-3.5 w-3.5 text-critical" />
                    Below opening
                  </span>
                ) : liters === null ? (
                  "—"
                ) : (
                  formatLiters(liters, 2)
                )}
              </td>
              <td className={`${tdClass} ${numClass}`}>
                {amount === null ? "—" : formatMoney(amount, currency)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold text-zinc-900 dark:text-zinc-50">
            <td className="px-3 py-2.5" colSpan={4}>
              Total
            </td>
            <td className={`px-3 py-2.5 ${numClass}`}>{formatLiters(totalLiters, 2)}</td>
            <td className={`px-3 py-2.5 ${numClass}`}>{formatMoney(totalAmount, currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  if (!editable) return table;

  return (
    <ActionForm action={action} resetOnSuccess={false} className="flex flex-col gap-4">
      {table}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Save readings</SubmitButton>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Each opening meter is where that nozzle&apos;s last reading closed. Nozzles without a closing meter are skipped.
        </p>
      </div>
    </ActionForm>
  );
}
