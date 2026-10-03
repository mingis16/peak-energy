import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { buttonSecondary, inputClass } from "@/components/ui/styles";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { ShiftTable } from "@/components/shifts/shift-table";
import { StartShiftForm } from "@/components/shifts/start-shift-form";
import { getStationSettings, isManager, requireStaff } from "@/lib/auth";
import { rows } from "@/lib/data";
import { addDaysISO, isISODate, todayISO } from "@/lib/format";
import type { Profile, ShiftSummary } from "@/lib/types";

export const metadata: Metadata = { title: "Shifts" };

const STATUSES = ["OPEN", "SUBMITTED", "RECONCILED"] as const;

export default async function ShiftsPage({ searchParams }: PageProps<"/shifts">) {
  const { supabase, profile } = await requireStaff();
  const settings = await getStationSettings();
  const manager = isManager(profile.role);
  const params = await searchParams;

  const to = isISODate(params.to) ? params.to : todayISO();
  const from = isISODate(params.from) ? params.from : addDaysISO(to, -13);
  const status = STATUSES.find((s) => s === params.status);

  let query = supabase
    .from("v_shift_summary")
    .select("*")
    .gte("shift_date", from)
    .lte("shift_date", to)
    .order("shift_date", { ascending: false })
    .order("opened_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const [shiftsResult, staffResult] = await Promise.all([
    query,
    manager
      ? supabase.from("profiles").select("*").in("role", ["owner", "manager", "attendant"]).order("full_name")
      : Promise.resolve({ data: null, error: null }),
  ]);
  const shifts = rows<ShiftSummary>(shiftsResult, "shifts");
  const staff = manager ? rows<Profile>(staffResult, "staff") : undefined;

  return (
    <>
      <PageHeader
        title="Shifts"
        description="Open a shift, log pump meters, hand over collections and reconcile."
        actions={<RealtimeRefresh channel="shifts-list" tables={["shifts", "pump_readings"]} />}
      />

      <div className="flex flex-col gap-5">
        <Card title="Start a shift">
          <StartShiftForm staff={staff} currentUserId={profile.id} />
        </Card>

        <Card
          title={manager ? "All shifts" : "Your shifts"}
          description="Shortages beyond the tolerance set in Settings are flagged."
        >
          <form className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
            <Field label="From" htmlFor="from">
              <input id="from" name="from" type="date" defaultValue={from} className={inputClass} />
            </Field>
            <Field label="To" htmlFor="to">
              <input id="to" name="to" type="date" defaultValue={to} className={inputClass} />
            </Field>
            <Field label="Status" htmlFor="status">
              <select id="status" name="status" defaultValue={status ?? ""} className={inputClass}>
                <option value="">Any status</option>
                <option value="OPEN">Open</option>
                <option value="SUBMITTED">Awaiting review</option>
                <option value="RECONCILED">Reconciled</option>
              </select>
            </Field>
            <button type="submit" className={`${buttonSecondary} self-end`}>
              Filter
            </button>
          </form>
          <ShiftTable shifts={shifts} currency={settings.currency_code} showAttendant={manager} />
        </Card>
      </div>
    </>
  );
}
