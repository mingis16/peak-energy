import { clsx } from "clsx";
import { AlertOctagon, AlertTriangle, CheckCircle2, Circle, Clock, Lock } from "lucide-react";

export type Tone = "good" | "warning" | "serious" | "critical" | "neutral" | "info";

const ICONS = {
  good: CheckCircle2,
  warning: AlertTriangle,
  serious: AlertTriangle,
  critical: AlertOctagon,
  neutral: Circle,
  info: Clock,
} as const;

const ICON_COLORS: Record<Tone, string> = {
  good: "text-good",
  warning: "text-warning",
  serious: "text-serious",
  critical: "text-critical",
  neutral: "text-zinc-400",
  info: "text-series-1",
};

/** Status is always icon + label, never colour alone. */
export function StatusBadge({
  tone,
  children,
  locked = false,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  locked?: boolean;
  className?: string;
}) {
  const Icon = locked ? Lock : ICONS[tone];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200",
        className,
      )}
    >
      <Icon aria-hidden className={clsx("h-3.5 w-3.5", ICON_COLORS[tone])} />
      {children}
    </span>
  );
}

export function shiftStatusBadge(status: string, isShort: boolean) {
  if (status === "OPEN") return <StatusBadge tone="info">Open</StatusBadge>;
  if (status === "SUBMITTED")
    return <StatusBadge tone={isShort ? "serious" : "warning"}>Awaiting review</StatusBadge>;
  return (
    <StatusBadge tone="good" locked>
      Reconciled
    </StatusBadge>
  );
}

export function stockStatusBadge(status: string) {
  if (status === "CRITICAL") return <StatusBadge tone="critical">Critical</StatusBadge>;
  if (status === "OUT") return <StatusBadge tone="critical">Out of stock</StatusBadge>;
  if (status === "LOW") return <StatusBadge tone="warning">Low</StatusBadge>;
  return <StatusBadge tone="good">OK</StatusBadge>;
}
