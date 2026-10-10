import { redirect } from "next/navigation";
import { BottomNav } from "@/components/shell/bottom-nav";
import type { NavContext } from "@/components/shell/nav-links";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { accessFor, getStationSettings, requireStaff } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { profile } = await requireStaff();
  const settings = await getStationSettings();
  // A new owner answers the setup questions before anything else.
  if (profile.role === "owner" && !settings.setup_completed_at) redirect("/setup");

  const access = accessFor(profile.role, settings);
  const nav: NavContext = {
    role: profile.role,
    money: access.finances || access.cashBook,
    bar: { enabled: settings.bar_enabled, name: settings.bar_name },
  };

  return (
    <div className="flex min-h-dvh flex-1">
      <Sidebar nav={nav} stationName={settings.station_name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar profile={profile} stationName={settings.station_name} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-10">
          {children}
        </main>
      </div>
      <BottomNav nav={nav} />
    </div>
  );
}
