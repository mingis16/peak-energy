import Link from "next/link";
import { Banknote, Droplets, Fuel, TrendingUp } from "lucide-react";
import { BarChart } from "@/components/charts/bar-chart";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { TankMeter } from "@/components/dashboard/tank-meter";
import { ShiftTable } from "@/components/shifts/shift-table";
import { StartShiftForm } from "@/components/shifts/start-shift-form";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusBadge, stockStatusBadge } from "@/components/ui/status-badge";
import { buttonSecondary, inputClass, numClass } from "@/components/ui/styles";
import { getStationSettings, isManager, requireStaff } from "@/lib/auth";
import { row, rows } from "@/lib/data";
import {
  addDaysISO,
  formatDate,
  formatLiters,
  formatMoney,
  formatSignedMoney,
  isISODate,
  todayISO,
} from "@/lib/format";
import type {
  BarStock,
  DashboardKpis,
  Profile,
  ShiftSummary,
  StationSettings,
  TankStatus,
  TrendRow,
} from "@/lib/types";

const LIVE_TABLES = [
  "tanks",
  "shifts",
  "pump_readings",
  "tank_dips",
  "fuel_deliveries",
  "bar_sales",
  "bar_inventory",
  "financial_transactions",
] as const;

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const { supabase, profile } = await requireStaff();
  const settings = await getStationSettings();
  if (!isManager(profile.role)) return <AttendantHome profile={profile} settings={settings} />;

  const { date: dateParam } = await searchParams;
  const date = isISODate(dateParam) ? dateParam : todayISO();
  const currency = settings.currency_code;

  const [kpiResult, tanksResult, shiftsResult, trendResult, lowStockResult] = await Promise.all([
    supabase.rpc("get_dashboard_kpis", { p_date: date }),
    supabase.from("v_tank_status").select("*").eq("is_active", true).order("tank_name"),
    supabase.from("v_shift_summary").select("*").eq("shift_date", date).order("opened_at"),
    supabase.rpc("get_daily_trend", { p_from: addDaysISO(date, -13), p_to: date }),
    supabase
      .from("v_bar_stock")
      .select("*")
      .eq("is_active", true)
      .neq("stock_status", "OK")
      .order("quantity_in_stock")
      .limit(8),
  ]);

  const k = row<DashboardKpis>(kpiResult, "dashboard figures")!;
  const tanks = rows<TankStatus>(tanksResult, "tanks");
  const shifts = rows<ShiftSummary>(shiftsResult, "shifts");
  const trend = rows<TrendRow>(trendResult, "sales trend");
  const lowStock = rows<BarStock>(lowStockResult, "bar stock");

  const handover = k.handover;
  const tolerance = Number(settings.shortage_tolerance);
  const isToday = date === todayISO();
  const trendTotal = trend.reduce((sum, d) => sum + Number(d.fuel_sales) + Number(d.bar_sales), 0);

  return (
    <>
      <PageHeader
        title={isToday ? "Today" : formatDate(date)}
        description={`${settings.station_name} · ${formatDate(date)}`}
        actions={
          <>
            <form className="flex items-center gap-2">
              <label htmlFor="date" className="sr-only">
                Date
              </label>
              <input id="date" name="date" type="date" defaultValue={date} className={`${inputClass} w-auto`} />
              <button type="submit" className={buttonSecondary}>
                Go
              </button>
            </form>
            {!isToday && (
              <Link href="/" className={buttonSecondary}>
                Today
              </Link>
            )}
            <RealtimeRefresh channel="dashboard" tables={LIVE_TABLES} />
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Fuel volume sold"
            icon={Droplets}
            value={formatLiters(k.fuel_liters, 0)}
            detail={
              k.fuel_by_type.length
                ? k.fuel_by_type.map((f) => `${f.fuel_type} ${formatLiters(f.liters, 0)}`).join(" · ")
                : "No meter readings yet"
            }
          />
          <StatTile
            label="Cash collected vs expected"
            icon={Banknote}
            value={formatMoney(handover.collected, currency)}
            detail={
              handover.shifts
                ? `of ${formatMoney(handover.expected, currency)} expected from ${handover.shifts} handed-over shift${handover.shifts === 1 ? "" : "s"}`
                : "No shifts handed over yet"
            }
            status={
              handover.shifts === 0 ? (
                k.shifts.open ? (
                  <StatusBadge tone="info">
                    {formatMoney(k.open_shift_sales, currency)} in open shifts
                  </StatusBadge>
                ) : null
              ) : Number(handover.variance) < -tolerance ? (
                <StatusBadge tone="critical">Short {formatMoney(-handover.variance, currency)}</StatusBadge>
              ) : Number(handover.variance) > 0 ? (
                <StatusBadge tone="warning">Over {formatMoney(handover.variance, currency)}</StatusBadge>
              ) : (
                <StatusBadge tone="good">Balanced</StatusBadge>
              )
            }
          />
          <StatTile
            label="Gross / net earnings"
            icon={TrendingUp}
            value={formatMoney(k.gross_profit, currency)}
            detail={
              <>
                Net{" "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {formatSignedMoney(k.net_profit, currency)}
                </span>{" "}
                after expenses &amp; cash differences
              </>
            }
          />
          <StatTile
            label="Tank status"
            icon={Fuel}
            value={k.tanks_total ? `${k.tanks_total - k.tanks_low} of ${k.tanks_total} OK` : "No tanks"}
            detail="Compared with each tank's reorder level"
            status={
              k.tanks_low > 0 ? (
                <StatusBadge tone="warning">
                  {k.tanks_low} tank{k.tanks_low === 1 ? "" : "s"} need{k.tanks_low === 1 ? "s" : ""} fuel
                </StatusBadge>
              ) : k.tanks_total ? (
                <StatusBadge tone="good">All above reorder level</StatusBadge>
              ) : null
            }
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <Card
            className="lg:col-span-2"
            title="Sales, last 14 days"
            description={`Fuel and bar sales per day · ${formatMoney(trendTotal, currency)} in total`}
          >
            <BarChart
              title="Daily sales, last 14 days"
              currency={currency}
              data={trend.map((d) => ({
                key: d.day,
                axisLabel: String(Number(d.day.slice(8, 10))),
                label: formatDate(d.day),
                value: Number(d.fuel_sales) + Number(d.bar_sales),
              }))}
            />
          </Card>

          <Card title="How the day adds up" description="Live: includes shifts that are still open.">
            <dl className="flex flex-col gap-2 text-sm">
              <Line label="Fuel sales" value={formatMoney(k.fuel_sales, currency)} />
              <Line label="Bar sales" value={formatMoney(k.bar_sales, currency)} />
              <Line label="Cost of goods sold" value={formatMoney(-(Number(k.fuel_cogs) + Number(k.bar_cogs)), currency)} />
              {Number(k.stock_loss) !== 0 && (
                <Line label="Dip variance (stock loss)" value={formatMoney(-k.stock_loss, currency)} />
              )}
              <Line label="Gross profit" value={formatMoney(k.gross_profit, currency)} strong />
              <Line label="Operating expenses" value={formatMoney(-k.operating_expenses, currency)} />
              {Number(k.other_income) !== 0 && <Line label="Other income" value={formatMoney(k.other_income, currency)} />}
              <Line label="Cash shortages / overages" value={formatSignedMoney(k.cash_variance, currency)} />
              <Line label="Net profit" value={formatSignedMoney(k.net_profit, currency)} strong />
            </dl>
          </Card>
        </div>

        <Card
          title={`Shifts on ${formatDate(date, false)}`}
          description={`${k.shifts.open} open · ${k.shifts.awaiting_review} awaiting review · ${k.shifts.reconciled} reconciled`}
          actions={
            <Link href="/shifts" className={buttonSecondary}>
              All shifts
            </Link>
          }
        >
          <ShiftTable shifts={shifts} currency={currency} showDate={false} />
        </Card>

        <Card
          title="Tanks"
          actions={
            <Link href="/tanks" className={buttonSecondary}>
              Dips &amp; deliveries
            </Link>
          }
        >
          {tanks.length === 0 ? (
            <EmptyState>
              No tanks yet. <Link href="/settings" className="underline">Add tanks in Settings.</Link>
            </EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tanks.map((tank) => (
                <TankMeter key={tank.id} tank={tank} />
              ))}
            </div>
          )}
        </Card>

        {lowStock.length > 0 && (
          <Card
            title="Bar items to reorder"
            actions={
              <Link href="/bar" className={buttonSecondary}>
                Bar
              </Link>
            }
          >
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {lowStock.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-zinc-800 dark:text-zinc-200">
                    {item.item_name} <span className="text-zinc-400">· {item.category}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                      {item.quantity_in_stock} left
                    </span>
                    {stockStatusBadge(item.stock_status)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={
        strong
          ? "flex justify-between gap-3 border-t border-zinc-200 pt-2 font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-50"
          : "flex justify-between gap-3 text-zinc-600 dark:text-zinc-300"
      }
    >
      <dt>{label}</dt>
      <dd className={numClass}>{value}</dd>
    </div>
  );
}

async function AttendantHome({ profile, settings }: { profile: Profile; settings: StationSettings }) {
  const { supabase } = await requireStaff();
  const [shiftsResult, tanksResult] = await Promise.all([
    supabase
      .from("v_shift_summary")
      .select("*")
      .eq("attendant_id", profile.id)
      .order("shift_date", { ascending: false })
      .order("opened_at", { ascending: false })
      .limit(10),
    supabase.from("v_tank_status").select("*").eq("is_active", true).order("tank_name"),
  ]);
  const shifts = rows<ShiftSummary>(shiftsResult, "shifts");
  const tanks = rows<TankStatus>(tanksResult, "tanks");
  const open = shifts.filter((s) => s.status === "OPEN");
  const firstName = (profile.full_name || "").split(" ")[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Hello, ${firstName}` : "Hello"}
        description={`${settings.station_name} · ${formatDate(todayISO())}`}
        actions={<RealtimeRefresh channel="attendant-home" tables={["shifts", "pump_readings", "tanks"]} />}
      />
      <div className="flex flex-col gap-5">
        {open.length > 0 ? (
          <Card title="Your open shift" description="Log closing meters and hand over before you leave.">
            <div className="flex flex-col gap-2">
              {open.map((s) => (
                <Link
                  key={s.id}
                  href={`/shifts/${s.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <span>
                    <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {s.shift_label === "Day" ? "Full day" : s.shift_label} · {formatDate(s.shift_date)}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {s.reading_count} reading{s.reading_count === 1 ? "" : "s"} ·{" "}
                      {formatMoney(s.expected_sales, settings.currency_code)} expected so far
                    </span>
                  </span>
                  <span className={buttonSecondary}>Continue</span>
                </Link>
              ))}
            </div>
          </Card>
        ) : (
          <Card title="Start your shift">
            <StartShiftForm currentUserId={profile.id} />
          </Card>
        )}

        <Card title="Your recent shifts">
          <ShiftTable shifts={shifts} currency={settings.currency_code} showAttendant={false} />
        </Card>

        <Card title="Tanks">
          {tanks.length === 0 ? (
            <EmptyState>No tanks have been set up yet.</EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tanks.map((tank) => (
                <TankMeter key={tank.id} tank={tank} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
