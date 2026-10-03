import { clsx } from "clsx";

export function StatTile({
  label,
  value,
  detail,
  icon: Icon,
  status,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  status?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-zinc-400" />}
      </div>
      <div className="truncate text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {value}
      </div>
      {detail && <div className="text-xs text-zinc-500 dark:text-zinc-400">{detail}</div>}
      {status && <div className={clsx("mt-1")}>{status}</div>}
    </div>
  );
}
