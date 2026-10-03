import { BottomNav } from "@/components/shell/bottom-nav";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { getStationSettings, requireStaff } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { profile } = await requireStaff();
  const settings = await getStationSettings();

  return (
    <div className="flex min-h-dvh flex-1">
      <Sidebar role={profile.role} stationName={settings.station_name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar profile={profile} stationName={settings.station_name} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-10">
          {children}
        </main>
      </div>
      <BottomNav role={profile.role} />
    </div>
  );
}
