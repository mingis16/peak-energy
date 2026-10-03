import { Fuel } from "lucide-react";

export function Brand({ stationName }: { stationName: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-3 py-1">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900">
        <Fuel className="h-4 w-4" />
      </span>
      <span className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {stationName}
      </span>
    </div>
  );
}
