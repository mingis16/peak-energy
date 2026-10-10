import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";
import { BarForm } from "@/components/settings/bar-form";
import { CategoriesSection } from "@/components/settings/categories";
import { FuelPricesSection, loadEquipment, PumpsSection, TanksSection } from "@/components/settings/equipment";
import { ShiftsForm } from "@/components/settings/shifts-form";
import { AddMemberForm, MemberList } from "@/components/settings/staff";
import { AccessForm, ControlsForm, PaymentsForm, StationForm } from "@/components/settings/station-forms";
import { Card, PageHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonSecondary } from "@/components/ui/styles";
import { getStationSettings, requireManager } from "@/lib/auth";
import { rows } from "@/lib/data";
import { signupUrl } from "@/lib/station";
import { canCreateAccounts } from "@/lib/supabase/admin";
import type { Supabase } from "@/lib/supabase/server";
import type { Account, Profile, StationSettings, TransactionCategory } from "@/lib/types";

export const metadata: Metadata = { title: "Settings" };

// Managers look after fuel prices and equipment; everything else is the owner's.
const TABS = [
  { id: "station", label: "Station", ownerOnly: true },
  { id: "equipment", label: "Fuel & equipment", ownerOnly: false },
  { id: "shifts", label: "Shifts & payments", ownerOnly: true },
  { id: "bar", label: "Besides fuel", ownerOnly: true },
  { id: "cashbook", label: "Cash book", ownerOnly: true },
  { id: "staff", label: "Staff & access", ownerOnly: true },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { supabase, profile } = await requireManager();
  const settings = await getStationSettings();
  const owner = profile.role === "owner";
  const tabs = TABS.filter((t) => owner || !t.ownerOnly);
  const { tab: tabParam } = await searchParams;
  const tab: Tab = tabs.find((t) => t.id === tabParam)?.id ?? tabs[0].id;

  const { count: pendingCount } = owner
    ? await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "pending")
    : { count: 0 };

  return (
    <>
      <PageHeader
        title="Settings"
        description={owner ? "Set the app up the way your station runs." : "Fuel prices, tanks and pumps."}
        actions={
          owner && (
            <Link href="/setup" className={buttonSecondary}>
              Go through the setup questions
            </Link>
          )
        }
      />

      {tabs.length > 1 && (
        <nav
          aria-label="Settings sections"
          className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950"
        >
          {tabs.map((t) => (
            <Link
              key={t.id}
              href={`/settings?tab=${t.id}`}
              aria-current={t.id === tab ? "page" : undefined}
              className={clsx(
                "inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium",
                t.id === tab
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900",
              )}
            >
              {t.label}
              {t.id === "staff" && Boolean(pendingCount) && (
                <span className="rounded-full bg-warning px-1.5 text-xs text-zinc-900">{pendingCount}</span>
              )}
            </Link>
          ))}
        </nav>
      )}

      {owner && Boolean(pendingCount) && tab !== "staff" && (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <StatusBadge tone="warning">{pendingCount} waiting</StatusBadge>
          New staff accounts are waiting for a role.{" "}
          <Link href="/settings?tab=staff" className="underline">
            Give them one
          </Link>
        </p>
      )}

      <div className="flex flex-col gap-5">
        {tab === "station" && (
          <>
            <Card title="Station">
              <StationForm settings={settings} />
            </Card>
            <Card
              title="Controls"
              description="Rules that stop losses going unnoticed. Only you can change them."
            >
              <ControlsForm settings={settings} />
            </Card>
          </>
        )}
        {tab === "equipment" && <EquipmentTab supabase={supabase} settings={settings} owner={owner} />}
        {tab === "shifts" && (
          <>
            <Card title="Shifts" description="The shifts attendants choose from when they start work.">
              <ShiftsForm shiftNames={settings.shift_names} />
            </Card>
            <Card title="Payments" description="How customers pay. Attendants declare each kind at handover.">
              <PaymentsForm settings={settings} />
            </Card>
          </>
        )}
        {tab === "bar" && (
          <Card
            title="Besides fuel"
            description="Anything else you sell, such as drinks or lubricants. Switched off, it disappears from the menu."
          >
            <BarForm settings={settings} />
          </Card>
        )}
        {tab === "cashbook" && <CashBookTab supabase={supabase} />}
        {tab === "staff" && <StaffTab supabase={supabase} settings={settings} me={profile.id} />}
      </div>
    </>
  );
}

async function EquipmentTab({ supabase, settings, owner }: { supabase: Supabase; settings: StationSettings; owner: boolean }) {
  const equipment = await loadEquipment(supabase);
  const currency = settings.currency_code;
  return (
    <>
      <Card
        title="Fuel prices"
        description="Pump price is what customers pay. Average cost is kept up to date by deliveries; set it by hand only for opening stock."
      >
        <FuelPricesSection equipment={equipment} currency={currency} />
      </Card>
      <Card
        title="Tanks"
        description="Before a tank is used, set its fuel and the stock in it now (from a dip). After its first reading, dip or delivery, stock changes only through those."
      >
        <TanksSection equipment={equipment} currency={currency} />
      </Card>
      <Card
        title="Pumps"
        description="One row per metered nozzle. Before a pump's first reading, enter its real meter. After that, each shift opens where the last one closed, and only the owner can correct a meter."
      >
        <PumpsSection equipment={equipment} owner={owner} />
      </Card>
    </>
  );
}

async function CashBookTab({ supabase }: { supabase: Supabase }) {
  const [categoriesResult, accountsResult] = await Promise.all([
    supabase.from("transaction_categories").select("*").order("name"),
    supabase.from("accounts").select("*").order("code"),
  ]);
  return (
    <Card
      title="Cash-book categories"
      description="What money in and out is recorded as. Rename them, switch off the ones you don't use, or add your own."
    >
      <CategoriesSection
        categories={rows<TransactionCategory>(categoriesResult, "categories")}
        accounts={rows<Account>(accountsResult, "accounts")}
      />
    </Card>
  );
}

async function StaffTab({ supabase, settings, me }: { supabase: Supabase; settings: StationSettings; me: string }) {
  const staff = rows<Profile>(await supabase.from("profiles").select("*").order("created_at"), "staff");
  const canCreate = canCreateAccounts();
  return (
    <>
      <Card title="Add a member" description="Managers and attendants who work at the station.">
        <AddMemberForm canCreate={canCreate} signupUrl={signupUrl()} />
      </Card>
      <Card title="Staff" description="Change a name or role. Choose “No access” for someone who has left.">
        <MemberList staff={staff} me={me} canCreate={canCreate} />
      </Card>
      <Card title="Who sees what">
        <AccessForm settings={settings} />
      </Card>
    </>
  );
}
