import { Check, Minus } from "lucide-react";
import { updateAccess, updateControls, updatePayments, updateStation } from "@/app/(app)/settings/actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { inputClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { barWords, CURRENCIES, DATE_WINDOW_OPTIONS } from "@/lib/station";
import type { StationSettings } from "@/lib/types";
import { NextStep } from "./next-step";

interface FormProps {
  settings: StationSettings;
  /** The setup step to go to after saving. */
  next?: string;
  submitLabel?: string;
}

const optionCard =
  "flex items-start gap-3 rounded-lg border border-zinc-200 p-3 text-sm has-[:checked]:border-zinc-900 dark:border-zinc-800 dark:has-[:checked]:border-zinc-100";

export function StationForm({ settings, next, submitLabel = "Save" }: FormProps) {
  return (
    <ActionForm action={updateStation} resetOnSuccess={false} className="grid gap-4 sm:grid-cols-2">
      <NextStep next={next} />
      <Field label="Station name" htmlFor="station_name" hint="Shown at the top of every page.">
        <input id="station_name" name="station_name" defaultValue={settings.station_name} required className={inputClass} />
      </Field>
      <Field label="Currency" htmlFor="currency_code" hint="3-letter code, e.g. SLE. Changing it later does not convert amounts.">
        <input
          id="currency_code"
          name="currency_code"
          list="currency-codes"
          defaultValue={settings.currency_code}
          required
          maxLength={3}
          autoComplete="off"
          className={`${inputClass} uppercase`}
        />
        <datalist id="currency-codes">
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </datalist>
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ControlsForm({ settings, next, submitLabel = "Save controls" }: FormProps) {
  const windows = DATE_WINDOW_OPTIONS.some((o) => o.value === settings.attendant_date_window_days)
    ? DATE_WINDOW_OPTIONS
    : [...DATE_WINDOW_OPTIONS, { value: settings.attendant_date_window_days, label: `Up to ${settings.attendant_date_window_days} days either side` }];

  return (
    <ActionForm action={updateControls} resetOnSuccess={false} className="grid gap-4 sm:grid-cols-2">
      <NextStep next={next} />
      <Field label="Who opens shifts?" htmlFor="shift_opener">
        <select id="shift_opener" name="shift_opener" defaultValue={settings.attendants_open_shifts ? "attendants" : "managers"} className={inputClass}>
          <option value="attendants">Attendants open their own</option>
          <option value="managers">A manager opens them for attendants</option>
        </select>
      </Field>
      <Field
        label="Who records closing dips?"
        htmlFor="closing_dips_by"
        hint="Closing dips reveal stock losses, so it is safer if the attendants who sold the fuel don't record them."
      >
        <select
          id="closing_dips_by"
          name="closing_dips_by"
          defaultValue={settings.attendants_record_closing_dips ? "attendants" : "managers"}
          className={inputClass}
        >
          <option value="managers">Managers only (recommended)</option>
          <option value="attendants">Attendants too</option>
        </select>
      </Field>
      <Field
        label="Dates attendants can use"
        htmlFor="attendant_date_window_days"
        hint="For shifts, sales and dips. Stops back-dated records. Managers can record any day."
      >
        <select
          id="attendant_date_window_days"
          name="attendant_date_window_days"
          defaultValue={settings.attendant_date_window_days}
          className={inputClass}
        >
          {windows.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label={`Shortage tolerance (${settings.currency_code})`}
        htmlFor="shortage_tolerance"
        hint="Shift shortages up to this amount are not flagged. 0 flags every shortage."
      >
        <input
          id="shortage_tolerance"
          name="shortage_tolerance"
          inputMode="decimal"
          defaultValue={settings.shortage_tolerance}
          className={inputClass}
        />
      </Field>
      <Field
        label="Dip variance tolerance (%)"
        htmlFor="dip_variance_tolerance_percent"
        hint="A tank's daily loss or gain beyond this share of the litres sold is flagged."
      >
        <input
          id="dip_variance_tolerance_percent"
          name="dip_variance_tolerance_percent"
          inputMode="decimal"
          defaultValue={settings.dip_variance_tolerance_percent}
          className={inputClass}
        />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PaymentsForm({ settings, next, submitLabel = "Save payments" }: FormProps) {
  return (
    <ActionForm action={updatePayments} resetOnSuccess={false} className="flex flex-col gap-3">
      <NextStep next={next} />
      <p className="text-sm text-zinc-600 dark:text-zinc-300">Cash is always accepted. Which of these do you also take?</p>
      <label className={optionCard}>
        <input type="checkbox" name="accepts_digital_payments" defaultChecked={settings.accepts_digital_payments} className="mt-0.5" />
        <span>
          <span className="block font-medium text-zinc-900 dark:text-zinc-50">Bank transfers, cards or mobile money</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Attendants declare these apart from cash when they hand over.</span>
        </span>
      </label>
      <Field
        label="What you call these payments"
        htmlFor="digital_payments_label"
        hint={'Shown to attendants, e.g. "Orange Money" or "Bank / mobile money".'}
      >
        <input
          id="digital_payments_label"
          name="digital_payments_label"
          defaultValue={settings.digital_payments_label}
          maxLength={40}
          className={inputClass}
        />
      </Field>
      <label className={optionCard}>
        <input type="checkbox" name="accepts_customer_credit" defaultChecked={settings.accepts_customer_credit} className="mt-0.5" />
        <span>
          <span className="block font-medium text-zinc-900 dark:text-zinc-50">Credit customers</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            Customers who take fuel or goods now against a credit slip and pay later. The app keeps what they owe.
          </span>
        </span>
      </label>
      <div className="mt-1">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

type Can = boolean | "choice";

/** What each role can see and do. Managers' money access is the owner's choice. */
function accessRows(settings: StationSettings): { what: string; owner: Can; manager: Can; attendant: Can | string }[] {
  const bar = barWords(settings);
  return [
    { what: "Shifts and meter readings", owner: true, manager: true, attendant: "Their own" },
    { what: "Tank levels and opening dips", owner: true, manager: true, attendant: true },
    { what: "Closing dips and fuel deliveries", owner: true, manager: true, attendant: settings.attendants_record_closing_dips ? "Closing dips" : false },
    ...(settings.bar_enabled ? [{ what: `${bar.name}: sales`, owner: true, manager: true, attendant: true } as const] : []),
    { what: "Fuel prices, tanks and pumps", owner: true, manager: true, attendant: false },
    { what: "Approving shifts", owner: true, manager: true, attendant: false },
    { what: "Cash book", owner: true, manager: "choice", attendant: false },
    { what: "Accounts: profit, ledger and balances", owner: true, manager: "choice", attendant: false },
    { what: "Staff, station settings and the activity log", owner: true, manager: false, attendant: false },
  ];
}

function CanCell({ value }: { value: Can | string }) {
  if (value === true) return <Check aria-label="Yes" className="mx-auto h-4 w-4 text-good" />;
  if (value === false) return <Minus aria-label="No" className="mx-auto h-4 w-4 text-zinc-400" />;
  if (value === "choice") return <span className="text-xs font-medium">You choose ↓</span>;
  return <span className="text-xs">{value}</span>;
}

export function AccessForm({ settings, next, submitLabel = "Save access" }: FormProps) {
  return (
    <ActionForm action={updateAccess} resetOnSuccess={false} className="flex flex-col gap-4">
      <NextStep next={next} />
      <div className="-mx-4 overflow-x-auto px-4 md:-mx-5 md:px-5">
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={thClass}>Who sees what</th>
              <th className={`${thClass} text-center`}>Owner</th>
              <th className={`${thClass} text-center`}>Manager</th>
              <th className={`${thClass} text-center`}>Attendant</th>
            </tr>
          </thead>
          <tbody>
            {accessRows(settings).map((row) => (
              <tr key={row.what}>
                <td className={`${tdClass} whitespace-normal`}>{row.what}</td>
                <td className={`${tdClass} text-center`}>
                  <CanCell value={row.owner} />
                </td>
                <td className={`${tdClass} text-center`}>
                  <CanCell value={row.manager} />
                </td>
                <td className={`${tdClass} text-center`}>
                  <CanCell value={row.attendant} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <label className={optionCard}>
        <input type="checkbox" name="managers_use_cash_book" defaultChecked={settings.managers_use_cash_book} className="mt-0.5" />
        <span>
          <span className="block font-medium text-zinc-900 dark:text-zinc-50">Managers can use the cash book</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            Record expenses, supplier payments, bank deposits and other money in or out, and see those entries.
          </span>
        </span>
      </label>
      <label className={optionCard}>
        <input type="checkbox" name="managers_view_finances" defaultChecked={settings.managers_view_finances} className="mt-0.5" />
        <span>
          <span className="block font-medium text-zinc-900 dark:text-zinc-50">Managers can see the accounts</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            Profit &amp; loss, the ledger, balances such as cash at the bank and money owed, and costs and profit on the dashboard.
          </span>
        </span>
      </label>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Attendants never see the cash book, the accounts or the activity log, and only you see the activity log. The
        database enforces this, not just the screens.
      </p>
      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
