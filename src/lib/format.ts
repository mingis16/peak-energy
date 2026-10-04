// Display helpers. Values from Postgres numeric columns can arrive as numbers
// or strings, so every helper accepts both.

type Numeric = number | string | null | undefined;

export const STATION_TIMEZONE =
  process.env.NEXT_PUBLIC_STATION_TIMEZONE ?? "Africa/Freetown";

export function toNumber(value: Numeric): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(value: Numeric, currency: string, compact = false): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
    minimumFractionDigits: compact ? 0 : 2,
  }).format(toNumber(value));
}

/** Signed money, e.g. "+SLE 200.00" / "−SLE 800.00". */
export function formatSignedMoney(value: Numeric, currency: string): string {
  const n = toNumber(value);
  const formatted = formatMoney(Math.abs(n), currency);
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `−${formatted}`;
  return formatted;
}

export function formatNumber(value: Numeric, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits }).format(toNumber(value));
}

export function formatLiters(value: Numeric, maximumFractionDigits = 1): string {
  return `${formatNumber(value, maximumFractionDigits)} L`;
}

export function formatPercent(value: Numeric, maximumFractionDigits = 1): string {
  return `${formatNumber(value, maximumFractionDigits)}%`;
}

/** "2026-10-01" → "Thu 1 Oct 2026" */
export function formatDate(isoDate: string | null | undefined, withWeekday = true): string {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: withWeekday ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDateTime(timestamp: string | null | undefined): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: STATION_TIMEZONE,
  }).format(new Date(timestamp));
}

/** Today's date (YYYY-MM-DD) in the station's timezone. */
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: STATION_TIMEZONE }).format(new Date());
}

/** Dates attendants may record: today, or a day either side. The database enforces the same rule. */
export function attendantDateLimits(): { min: string; max: string } {
  const today = todayISO();
  return { min: addDaysISO(today, -1), max: addDaysISO(today, 1) };
}

export function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function isISODate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK: "Bank / mobile money",
  CREDIT: "On credit",
  OPENING: "Opening stock",
};
