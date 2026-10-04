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
  station_name: "Peak Energy",
  currency_code: "SLE",
  shortage_tolerance: 0,
  dip_variance_tolerance_percent: 0.5,
};

export const getStationSettings = cache(async (): Promise<StationSettings> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("station_settings")
    .select("station_name, currency_code, shortage_tolerance, dip_variance_tolerance_percent")
    .maybeSingle<StationSettings>();
  return data ?? DEFAULT_SETTINGS;
});

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
