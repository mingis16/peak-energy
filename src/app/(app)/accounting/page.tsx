import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";
import { CheckCircle2 } from "lucide-react";
import { addTransaction, deleteTransaction, updateTransaction } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { DeleteButton } from "@/components/ui/delete-button";
import { Field } from "@/components/ui/field";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buttonSecondary,
  buttonSmall,
  inputClass,
  numClass,
  tableClass,
  tdClass,
  thClass,
} from "@/components/ui/styles";
import { getStationSettings, requireMoneyAccess } from "@/lib/auth";
import { rows } from "@/lib/data";
import {
  addDaysISO,
  formatDate,
  formatMoney,
  formatNumber,
  isISODate,
  PAYMENT_LABELS,
  todayISO,
} from "@/lib/format";
import { barWords } from "@/lib/station";
import type { Supabase } from "@/lib/supabase/server";
import type {
  FinancialTransaction,
  LedgerLine,
  PnlRow,
  TransactionCategory,
  TrialBalanceRow,
} from "@/lib/types";

export const metadata: Metadata = { title: "Accounts" };

// The cash book is for those who may use it; the rest is the accounts.
const TABS = [
  { id: "overview", label: "Profit & loss", cashBook: false },
  { id: "transactions", label: "Cash book", cashBook: true },
  { id: "ledger", label: "Ledger", cashBook: false },
  { id: "balances", label: "Balances", cashBook: false },
] as const;
type Tab = (typeof TABS)[number]["id"];

const PRESETS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "mtd", label: "This month" },
  { id: "30d", label: "Last 30 days" },
] as const;

function sourceLabels(barName: string): Record<string, string> {
  return {
    SHIFT: "Shift",
    FUEL_DELIVERY: "Delivery",
    TANK_DIP: "Dip",
    BAR_SALE: `${barName} sale`,
    BAR_RESTOCK: `${barName} restock`,
    TRANSACTION: "Cash book",
    OPENING_BALANCE: "Opening",
  };
}

function resolveRange(params: Record<string, string | string[] | undefined>) {
  const today = todayISO();
  const preset = typeof params.preset === "string" ? params.preset : undefined;
  if (isISODate(params.from) && isISODate(params.to) && !preset) {
    return { from: params.from, to: params.to, preset: "custom" };
  }
  switch (preset) {
    case "today":
      return { from: today, to: today, preset };
    case "7d":
      return { from: addDaysISO(today, -6), to: today, preset };
    case "30d":
      return { from: addDaysISO(today, -29), to: today, preset };
    default:
      return { from: `${today.slice(0, 8)}01`, to: today, preset: "mtd" };
  }
}

export default async function AccountingPage({ searchParams }: PageProps<"/accounting">) {
  const { supabase, access } = await requireMoneyAccess();
  const settings = await getStationSettings();
  const currency = settings.currency_code;
  const barName = barWords(settings).name;
  const params = await searchParams;
  const tabs = TABS.filter((t) => access.finances || (t.cashBook && access.cashBook));
  const tab: Tab = tabs.find((t) => t.id === params.tab)?.id ?? tabs[0].id;
  const range = resolveRange(params);
  const entryId = typeof params.entry === "string" ? params.entry : undefined;
  const account = typeof params.account === "string" ? params.account : undefined;

  const hrefFor = (next: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = { tab, from: range.from, to: range.to, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) query.set(k, v);
    return `/accounting?${query}`;
  };

  return (
    <>
      <PageHeader
        title="Accounts"
        description={
          access.finances
            ? "Double-entry ledger. Everything below is posted automatically."
            : "Money in and out that is not fuel or sales."
        }
      />

      <nav aria-label="Accounts sections" className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={hrefFor({ tab: t.id, entry: undefined, account: undefined })}
            aria-current={t.id === tab ? "page" : undefined}
            className={clsx(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium",
              t.id === tab
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab !== "balances" && !entryId && (
        <div className="mb-5 flex flex-wrap items-end gap-2">
          {PRESETS.map((p) => (
            <Link
              key={p.id}
              href={`/accounting?tab=${tab}&preset=${p.id}`}
              className={clsx(buttonSecondary, buttonSmall, range.preset === p.id && "border-zinc-900 dark:border-zinc-100")}
            >
              {p.label}
            </Link>
          ))}
          <form className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value={tab} />
            <label className="sr-only" htmlFor="from">From</label>
            <input id="from" name="from" type="date" defaultValue={range.from} className={`${inputClass} w-auto py-1`} />
            <label className="sr-only" htmlFor="to">To</label>
            <input id="to" name="to" type="date" defaultValue={range.to} className={`${inputClass} w-auto py-1`} />
            <button type="submit" className={`${buttonSecondary} ${buttonSmall}`}>Apply</button>
          </form>
        </div>
      )}

      {tab === "overview" && (
        <ProfitAndLoss supabase={supabase} from={range.from} to={range.to} currency={currency} barName={barName} />
      )}
      {tab === "transactions" && (
        <CashBook supabase={supabase} from={range.from} to={range.to} currency={currency} canRecord={access.cashBook} />
      )}
      {tab === "ledger" && (
        <Ledger
          supabase={supabase}
          from={range.from}
          to={range.to}
          currency={currency}
          entryId={entryId}
          account={account}
          hrefFor={hrefFor}
          barName={barName}
        />
      )}
      {tab === "balances" && (
        <Balances
          supabase={supabase}
          asOf={isISODate(params.as_of) ? params.as_of : todayISO()}
          currency={currency}
          barName={barName}
        />
      )}
    </>
  );
}


// ---------------------------------------------------------------------------

async function ProfitAndLoss({
  supabase,
  from,
  to,
  currency,
  barName,
}: {
  supabase: Supabase;
  from: string;
  to: string;
  currency: string;
  barName: string;
}) {
  const [pnlResult, pendingResult] = await Promise.all([
    supabase.rpc("get_profit_and_loss", { p_from: from, p_to: to }),
    supabase
      .from("shifts")
      .select("id", { count: "exact", head: true })
      .gte("shift_date", from)
      .lte("shift_date", to)
      .neq("status", "RECONCILED"),
  ]);
  const pnl = rows<PnlRow>(pnlResult, "profit and loss");
  const pending = pendingResult.count ?? 0;

  const group = (g: PnlRow["report_group"]) => pnl.filter((r) => r.report_group === g);
  const total = (g: PnlRow["report_group"]) => group(g).reduce((sum, r) => sum + Number(r.amount), 0);
  const revenue = total("REVENUE");
  const cogs = total("COGS");
  const gross = revenue - cogs;
  const opex = total("OPEX");
  const other = total("OTHER_INCOME");
  const net = gross - opex + other;
  const margin = revenue ? (gross / revenue) * 100 : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Revenue" value={formatMoney(revenue, currency)} detail={`Fuel and ${barName} sales`} />
        <StatTile label="Cost of goods sold" value={formatMoney(cogs, currency)} detail="Incl. dip variance" />
        <StatTile
          label="Gross profit"
          value={formatMoney(gross, currency)}
          detail={margin === null ? "No sales" : `${formatNumber(margin, 1)}% margin`}
        />
        <StatTile label="Net profit" value={formatMoney(net, currency)} detail="After operating expenses" />
      </div>

      {pending > 0 && (
        <p className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <StatusBadge tone="warning">{pending} not reconciled</StatusBadge>
          Shifts in this period that are open or awaiting review are not in these figures yet.{" "}
          <Link href="/shifts?status=SUBMITTED" className="underline">Review shifts</Link>
        </p>
      )}

      <Card title="Profit & loss statement" description={`${formatDate(from)} – ${formatDate(to)}`}>
        <dl className="mx-auto flex max-w-2xl flex-col text-sm">
          <Section title="Revenue" rows={group("REVENUE")} currency={currency} />
          <Section title="Cost of goods sold" rows={group("COGS")} currency={currency} negative />
          <Total label="Gross profit" value={gross} currency={currency} />
          <Section title="Operating expenses" rows={group("OPEX")} currency={currency} negative />
          {group("OTHER_INCOME").length > 0 && (
            <Section title="Other income" rows={group("OTHER_INCOME")} currency={currency} />
          )}
          <Total label="Net profit" value={net} currency={currency} double />
        </dl>
      </Card>
    </div>
  );
}

function Section({ title, rows: lines, currency, negative = false }: { title: string; rows: PnlRow[]; currency: string; negative?: boolean }) {
  return (
    <div className="py-2">
      <dt className="pb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</dt>
      {lines.length === 0 ? (
        <dd className="py-1 text-zinc-400">None</dd>
      ) : (
        lines.map((line) => (
          <dd key={line.account_code} className="flex justify-between gap-3 py-1 text-zinc-700 dark:text-zinc-300">
            <span>{line.account_name}</span>
            <span className={numClass}>{formatMoney(negative ? -line.amount : line.amount, currency)}</span>
          </dd>
        ))
      )}
    </div>
  );
}

function Total({ label, value, currency, double = false }: { label: string; value: number; currency: string; double?: boolean }) {
  return (
    <div
      className={clsx(
        "flex justify-between gap-3 border-t py-2 font-semibold text-zinc-900 dark:text-zinc-50",
        double ? "border-t-2 border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-800",
      )}
    >
      <dt>{label}</dt>
      <dd className={numClass}>{formatMoney(value, currency)}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

async function CashBook({
  supabase,
  from,
  to,
  currency,
  canRecord,
}: {
  supabase: Supabase;
  from: string;
  to: string;
  currency: string;
  /** Those who may see the accounts but not use the cash book only read it. */
  canRecord: boolean;
}) {
  const [txResult, categoriesResult] = await Promise.all([
    supabase
      .from("financial_transactions")
      .select("*")
      .gte("transaction_date", from)
      .lte("transaction_date", to)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("transaction_categories").select("*").eq("is_active", true).order("name"),
  ]);
  const transactions = rows<FinancialTransaction>(txResult, "transactions");
  const categories = rows<TransactionCategory>(categoriesResult, "categories");
  const income = categories.filter((c) => c.transaction_type === "INCOME");
  const expense = categories.filter((c) => c.transaction_type === "EXPENSE");
  const moneyIn = transactions.filter((t) => t.transaction_type === "INCOME").reduce((s, t) => s + Number(t.amount), 0);
  const moneyOut = transactions.filter((t) => t.transaction_type === "EXPENSE").reduce((s, t) => s + Number(t.amount), 0);

  // Categories are the owner's to rename or switch off, so fall back to the first one.
  const defaultCategory = expense.find((c) => c.name === "Operating Expense")?.name ?? expense[0]?.name;
  const categorySelect = (id: string, defaultValue?: string) => (
    <select id={id} name="category" required defaultValue={defaultValue ?? defaultCategory} className={inputClass}>
      <optgroup label="Money out">
        {expense.map((c) => (
          <option key={c.name}>{c.name}</option>
        ))}
      </optgroup>
      <optgroup label="Money in">
        {income.map((c) => (
          <option key={c.name}>{c.name}</option>
        ))}
      </optgroup>
    </select>
  );

  return (
    <div className="flex flex-col gap-5">
      {canRecord && (
        <Card
          title="Record money in or out"
          description="Expenses, supplier payments, bank deposits and other income. Sales post themselves."
        >
          <ActionForm action={addTransaction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Category" htmlFor="category">
              {categorySelect("category")}
            </Field>
            <Field label={`Amount (${currency})`} htmlFor="amount">
              <input id="amount" name="amount" inputMode="decimal" required className={inputClass} />
            </Field>
            <Field label="Paid / received by" htmlFor="payment_method">
              <select id="payment_method" name="payment_method" defaultValue="CASH" className={inputClass}>
                <option value="CASH">Cash</option>
                <option value="BANK">Bank / mobile money</option>
                <option value="CREDIT">On credit (owed)</option>
              </select>
            </Field>
            <Field label="Date" htmlFor="transaction_date">
              <input id="transaction_date" name="transaction_date" type="date" defaultValue={todayISO()} className={inputClass} />
            </Field>
            <Field label="Description" htmlFor="description" className="sm:col-span-2 lg:col-span-3">
              <input id="description" name="description" placeholder="e.g. October generator diesel" className={inputClass} />
            </Field>
            <div className="flex items-end">
              <SubmitButton>Save</SubmitButton>
            </div>
          </ActionForm>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
              What each category does
            </summary>
            <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {[...expense, ...income].map((c) => (
                <div key={c.name}>
                  <dt className="font-medium text-zinc-800 dark:text-zinc-200">{c.name}</dt>
                  <dd className="text-xs text-zinc-500 dark:text-zinc-400">{c.description}</dd>
                </div>
              ))}
            </dl>
          </details>
        </Card>
      )}

      <Card
        title="Cash book"
        description={`${formatDate(from)} – ${formatDate(to)} · in ${formatMoney(moneyIn, currency)} · out ${formatMoney(moneyOut, currency)}`}
      >
        {transactions.length === 0 ? (
          <EmptyState>No transactions in this period.</EmptyState>
        ) : (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>Date</th>
                  <th className={thClass}>Category</th>
                  <th className={thClass}>Description</th>
                  <th className={thClass}>Method</th>
                  <th className={`${thClass} ${numClass}`}>In</th>
                  <th className={`${thClass} ${numClass}`}>Out</th>
                  {canRecord && <th className={thClass}><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td className={tdClass}>{formatDate(t.transaction_date)}</td>
                    <td className={tdClass}>{t.category}</td>
                    <td className={`${tdClass} max-w-xs truncate`} title={t.description ?? undefined}>
                      {t.description ?? "—"}
                      {t.recorded_by && <span className="block text-xs text-zinc-400">by {t.recorded_by}</span>}
                    </td>
                    <td className={tdClass}>{PAYMENT_LABELS[t.payment_method]}</td>
                    <td className={`${tdClass} ${numClass}`}>
                      {t.transaction_type === "INCOME" ? formatMoney(t.amount, currency) : ""}
                    </td>
                    <td className={`${tdClass} ${numClass}`}>
                      {t.transaction_type === "EXPENSE" ? formatMoney(t.amount, currency) : ""}
                    </td>
                    {canRecord && (
                      <td className={`${tdClass} text-right`}>
                        <div className="flex items-start justify-end gap-2">
                          <details className="text-left">
                            <summary className={`${buttonSecondary} ${buttonSmall} cursor-pointer list-none`}>Edit</summary>
                            <ActionForm
                              action={updateTransaction.bind(null, t.id)}
                              resetOnSuccess={false}
                              className="mt-2 grid w-64 gap-2 whitespace-normal"
                            >
                              {categorySelect(`category-${t.id}`, t.category)}
                              <input name="amount" defaultValue={t.amount} inputMode="decimal" aria-label="Amount" className={inputClass} />
                              <select name="payment_method" defaultValue={t.payment_method} aria-label="Payment method" className={inputClass}>
                                <option value="CASH">Cash</option>
                                <option value="BANK">Bank / mobile money</option>
                                <option value="CREDIT">On credit (owed)</option>
                              </select>
                              <input name="transaction_date" type="date" defaultValue={t.transaction_date} aria-label="Date" className={inputClass} />
                              <input name="description" defaultValue={t.description ?? ""} aria-label="Description" className={inputClass} />
                              <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Save</SubmitButton>
                            </ActionForm>
                          </details>
                          <DeleteButton action={deleteTransaction.bind(null, t.id)} confirm="Delete this transaction and reverse its ledger posting?" />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

async function Ledger({
  supabase,
  from,
  to,
  currency,
  entryId,
  account,
  hrefFor,
  barName,
}: {
  supabase: Supabase;
  from: string;
  to: string;
  currency: string;
  entryId?: string;
  account?: string;
  hrefFor: (next: Record<string, string | undefined>) => string;
  barName: string;
}) {
  const sources = sourceLabels(barName);
  let query = supabase.from("v_ledger").select("*");
  if (entryId) {
    query = query.eq("entry_id", entryId);
  } else {
    query = query.gte("entry_date", from).lte("entry_date", to);
  }
  const [linesResult, accountsResult] = await Promise.all([
    query.order("entry_date", { ascending: false }).order("created_at", { ascending: false }).order("line_id").limit(1000),
    supabase.from("accounts").select("code, name").order("code"),
  ]);
  const allLines = rows<LedgerLine>(linesResult, "ledger");
  const accounts = rows<{ code: string; name: string }>(accountsResult, "accounts");

  // Keep whole entries when filtering by account so each still balances on screen.
  const entryIds = account ? new Set(allLines.filter((l) => l.account_code === account).map((l) => l.entry_id)) : null;
  const lines = entryIds ? allLines.filter((l) => entryIds.has(l.entry_id)) : allLines;

  const entries: { id: string; date: string; description: string; source: string; lines: LedgerLine[] }[] = [];
  for (const line of lines) {
    let entry = entries[entries.length - 1];
    if (!entry || entry.id !== line.entry_id) {
      entry = { id: line.entry_id, date: line.entry_date, description: line.description, source: line.source_type, lines: [] };
      entries.push(entry);
    }
    entry.lines.push(line);
  }

  return (
    <Card
      title={entryId ? "Journal entry" : "General ledger"}
      description={entryId ? undefined : `${formatDate(from)} – ${formatDate(to)} · ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`}
      actions={
        entryId ? (
          <Link href={hrefFor({ entry: undefined })} className={`${buttonSecondary} ${buttonSmall}`}>
            Show all entries
          </Link>
        ) : (
          <form className="flex items-center gap-2">
            <input type="hidden" name="tab" value="ledger" />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <label htmlFor="account" className="sr-only">Account</label>
            <select id="account" name="account" defaultValue={account ?? ""} className={`${inputClass} w-auto py-1`}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
            <button type="submit" className={`${buttonSecondary} ${buttonSmall}`}>Filter</button>
          </form>
        )
      }
    >
      {entries.length === 0 ? (
        <EmptyState>No ledger entries.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {entries.map((entry) => {
            const debit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
            const credit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
            return (
              <div key={entry.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-900">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{entry.description}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatDate(entry.date)} · {sources[entry.source] ?? entry.source}
                    </p>
                  </div>
                  {Math.abs(debit - credit) < 0.005 && (
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-good" /> Balanced
                    </span>
                  )}
                </div>
                <TableWrap>
                  <table className={tableClass}>
                    <thead>
                      <tr>
                        <th className={thClass}>Account</th>
                        <th className={thClass}>Memo</th>
                        <th className={`${thClass} ${numClass}`}>Debit</th>
                        <th className={`${thClass} ${numClass}`}>Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.lines.map((line) => (
                        <tr key={line.line_id} className={account === line.account_code ? "bg-zinc-50 dark:bg-zinc-900" : undefined}>
                          <td className={clsx(tdClass, Number(line.credit) > 0 && "pl-8")}>
                            <span className="text-zinc-400">{line.account_code}</span> {line.account_name}
                          </td>
                          <td className={`${tdClass} text-zinc-500`}>{line.memo ?? ""}</td>
                          <td className={`${tdClass} ${numClass}`}>{Number(line.debit) ? formatMoney(line.debit, currency) : ""}</td>
                          <td className={`${tdClass} ${numClass}`}>{Number(line.credit) ? formatMoney(line.credit, currency) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function keyAccounts(barName: string) {
  return [
    { code: "1000", label: "Cash on hand" },
    { code: "1010", label: "Bank & mobile money" },
    { code: "1100", label: "Owed by credit customers" },
    { code: "2000", label: "Owed to suppliers" },
    { code: "1200", label: "Fuel stock (at cost)" },
    { code: "1210", label: `${barName} stock (at cost)` },
  ];
}

async function Balances({ supabase, asOf, currency, barName }: { supabase: Supabase; asOf: string; currency: string; barName: string }) {
  const tb = rows<TrialBalanceRow>(await supabase.rpc("get_trial_balance", { p_as_of: asOf }), "trial balance");
  const byCode = new Map(tb.map((r) => [r.account_code, r]));
  const totalDebit = tb.reduce((s, r) => s + Number(r.total_debit), 0);
  const totalCredit = tb.reduce((s, r) => s + Number(r.total_credit), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

  return (
    <div className="flex flex-col gap-5">
      <form className="flex items-end gap-2">
        <input type="hidden" name="tab" value="balances" />
        <Field label="As of" htmlFor="as_of">
          <input id="as_of" name="as_of" type="date" defaultValue={asOf} className={`${inputClass} w-auto`} />
        </Field>
        <button type="submit" className={buttonSecondary}>Show</button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {keyAccounts(barName).map((a) => (
          <StatTile key={a.code} label={a.label} value={formatMoney(byCode.get(a.code)?.balance ?? 0, currency)} />
        ))}
      </div>

      <Card
        title="Trial balance"
        description={`All postings up to ${formatDate(asOf)}`}
        actions={
          balanced ? (
            <StatusBadge tone="good">Debits = credits</StatusBadge>
          ) : (
            <StatusBadge tone="critical">Out of balance</StatusBadge>
          )
        }
      >
        <TableWrap>
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thClass}>Account</th>
                <th className={thClass}>Type</th>
                <th className={`${thClass} ${numClass}`}>Debits</th>
                <th className={`${thClass} ${numClass}`}>Credits</th>
                <th className={`${thClass} ${numClass}`}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {tb.map((r) => (
                <tr key={r.account_code}>
                  <td className={tdClass}>
                    <Link href={`/accounting?tab=ledger&account=${r.account_code}&from=2000-01-01&to=${asOf}`} className="hover:underline">
                      <span className="text-zinc-400">{r.account_code}</span> {r.account_name}
                    </Link>
                  </td>
                  <td className={`${tdClass} text-xs`}>{r.account_type.toLowerCase()}</td>
                  <td className={`${tdClass} ${numClass}`}>{formatMoney(r.total_debit, currency)}</td>
                  <td className={`${tdClass} ${numClass}`}>{formatMoney(r.total_credit, currency)}</td>
                  <td className={`${tdClass} ${numClass} font-medium`}>{formatMoney(r.balance, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-zinc-900 dark:text-zinc-50">
                <td className="px-3 py-2.5" colSpan={2}>Total</td>
                <td className={`px-3 py-2.5 ${numClass}`}>{formatMoney(totalDebit, currency)}</td>
                <td className={`px-3 py-2.5 ${numClass}`}>{formatMoney(totalCredit, currency)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
