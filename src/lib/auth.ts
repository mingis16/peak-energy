import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role, StationSettings } from "@/lib/types";

export const MANAGER_ROLES: Role[] = ["owner", "manager"];
export const STAFF_ROLES: Role[] = ["owner", "manager", "attendant"];

export function isManager(role: Role | undefined | null): boolean {
  return role === "owner" || role === "manager";
}

/** The signed-in user and their profile, memoised per request. */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, created_at")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  return { supabase, user, profile };
});

const DEFAULT_SETTINGS: StationSettings = {
  station_name: "SmartStation Pro",
  currency_code: "SLE",
  shortage_tolerance: 0,
  dip_variance_tolerance_percent: 0.5,
  // Settings that cannot be read (a pending account, or migrations not yet
  // applied) must not send anyone to the setup questions.
  setup_completed_at: new Date(0).toISOString(),
  shift_names: ["Morning", "Afternoon", "Night", "Full day"],
  attendants_open_shifts: true,
  accepts_customer_credit: true,
  accepts_digital_payments: true,
  digital_payments_label: "Bank / mobile money",
  bar_enabled: false,
  bar_name: "Shop",
  bar_item_label: "item",
  bar_categories: [],
  attendant_date_window_days: 1,
  attendants_record_closing_dips: false,
  managers_view_finances: false,
  managers_use_cash_book: false,
};

export const getStationSettings = cache(async (): Promise<StationSettings> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("station_settings")
    .select(
      "station_name, currency_code, shortage_tolerance, dip_variance_tolerance_percent, setup_completed_at, " +
        "shift_names, attendants_open_shifts, accepts_customer_credit, accepts_digital_payments, digital_payments_label, " +
        "bar_enabled, bar_name, bar_item_label, bar_categories, attendant_date_window_days, " +
        "attendants_record_closing_dips, managers_view_finances, managers_use_cash_book",
    )
    .maybeSingle<StationSettings>();
  return data ?? DEFAULT_SETTINGS;
});

/**
 * What a role may see beyond its own work. Attendants never see the money;
 * managers see it only where the owner allows. The database enforces the same.
 */
export function accessFor(role: Role, settings: StationSettings) {
  const owner = role === "owner";
  const manager = role === "manager";
  return {
    /** Profit & loss, the ledger, balances, and costs and profit on the dashboard. */
    finances: owner || (manager && settings.managers_view_finances),
    /** Recording money in and out. */
    cashBook: owner || (manager && settings.managers_use_cash_book),
  };
}

/** For pages: approved staff only. */
export async function requireStaff() {
  const session = await getSession();
  if (!session) redirect("/login");
  const { profile } = session;
  if (!profile || !STAFF_ROLES.includes(profile.role)) redirect("/pending");
  return { ...session, profile };
}

/** For pages: owners and managers only. */
export async function requireManager() {
  const session = await requireStaff();
  if (!isManager(session.profile.role)) redirect("/");
  return session;
}

/** For pages: the owner only. */
export async function requireOwner() {
  const session = await requireStaff();
  if (session.profile.role !== "owner") redirect("/");
  return session;
}

/** For pages: whoever may see the accounts or use the cash book. */
export async function requireMoneyAccess() {
  const session = await requireManager();
  const access = accessFor(session.profile.role, await getStationSettings());
  if (!access.finances && !access.cashBook) redirect("/");
  return { ...session, access };
}
