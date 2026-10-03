import { clsx } from "clsx";
import { formatLiters, formatNumber } from "@/lib/format";
import type { TankStatus } from "@/lib/types";
import { stockStatusBadge } from "@/components/ui/status-badge";

// The fill carries severity; the track is a lighter step of the same colour.
const TONES = {
  OK: { fill: "bg-series-1", track: "bg-series-1/15" },
  LOW: { fill: "bg-warning", track: "bg-warning/20" },
  CRITICAL: { fill: "bg-critical", track: "bg-critical/15" },
} as const;

export function TankMeter({ tank }: { tank: TankStatus }) {
  const tone = TONES[tank.stock_status];
  const fill = Math.min(100, Math.max(0, Number(tank.fill_percent)));
  const reorder = Math.min(100, (Number(tank.reorder_level_liters) / Number(tank.capacity_liters)) * 100);

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{tank.tank_name}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {tank.fuel_type} · {tank.fuel_name}
          </p>
        </div>
        {stockStatusBadge(tank.stock_status)}
      </div>

      <p className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {formatLiters(tank.current_volume, 0)}
        <span className="ml-1 text-sm font-normal text-zinc-500 dark:text-zinc-400">
          of {formatLiters(tank.capacity_liters, 0)}
        </span>
      </p>

      <div
        role="meter"
        aria-label={`${tank.tank_name} fill level`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fill}
        className={clsx("relative mt-2 h-2.5 rounded-full", tone.track)}
      >
        <div className={clsx("h-full rounded-full", tone.fill)} style={{ width: `${fill}%` }} />
        <div
          aria-hidden
          title={`Reorder level: ${formatLiters(tank.reorder_level_liters, 0)}`}
          className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-zinc-500 dark:bg-zinc-400"
          style={{ left: `calc(${reorder}% - 1px)` }}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <dt>Fill</dt>
        <dd className="text-right tabular-nums text-zinc-700 dark:text-zinc-300">{formatNumber(fill, 1)}%</dd>
        <dt>Reorder at</dt>
        <dd className="text-right tabular-nums text-zinc-700 dark:text-zinc-300">
          {formatLiters(tank.reorder_level_liters, 0)}
        </dd>
        <dt>Days of cover</dt>
        <dd className="text-right tabular-nums text-zinc-700 dark:text-zinc-300">
          {tank.days_of_cover === null ? "—" : `~${formatNumber(tank.days_of_cover, 1)}`}
        </dd>
      </dl>
    </div>
  );
}
