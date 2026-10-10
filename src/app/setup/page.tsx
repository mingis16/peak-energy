import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";
import { finishSetup } from "./actions";
import { BarForm } from "@/components/settings/bar-form";
import { loadEquipment, PumpsSection, TanksSection } from "@/components/settings/equipment";
import { ShiftsForm } from "@/components/settings/shifts-form";
import { AddMemberForm, MemberList } from "@/components/settings/staff";
import { AccessForm, ControlsForm, PaymentsForm, StationForm } from "@/components/settings/station-forms";
import { FuelSetupForm } from "@/components/setup/fuel-setup-form";
import { Brand } from "@/components/shell/brand";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { buttonPrimary, buttonSecondary, buttonSmall } from "@/components/ui/styles";
import { getStationSettings, requireOwner } from "@/lib/auth";
import { rows } from "@/lib/data";
import { signupUrl } from "@/lib/station";
import { canCreateAccounts } from "@/lib/supabase/admin";
import type { Supabase } from "@/lib/supabase/server";
import type { FuelProduct, Profile, StationSettings } from "@/lib/types";

export const metadata: Metadata = { title: "Set up your station" };

// The questions a new owner answers so the app fits how their station runs.
// Every answer can be changed later in Settings.
const STEPS = [
  { id: "station", title: "Your station", intro: "A few questions set the app up the way your station works. You can change any answer later in Settings." },
  { id: "fuels", title: "Fuels and prices", intro: "Which fuels do you sell, and what do customers pay per litre?" },
  { id: "tanks", title: "Tanks", intro: "Add each tank. Enter what is in it today, from a dip: that becomes your opening stock." },
  { id: "pumps", title: "Pumps", intro: "Add each nozzle, the tank it draws from and its meter (totaliser) reading now. Every shift starts where the last one closed." },
  { id: "shifts", title: "Shifts", intro: "How do your attendants work? Each shift is counted and handed over on its own." },
  { id: "payments", title: "Payments", intro: "How do customers pay? Attendants declare each kind at handover, and the app checks the total against the pump meters." },
  { id: "sales", title: "Besides fuel", intro: "Do you sell anything else, such as drinks or lubricants? The app can keep its stock and sales as well." },
  { id: "controls", title: "Controls", intro: "Rules that stop losses going unnoticed. Only you can change them." },
  { id: "access", title: "Who sees what", intro: "Attendants see only their own work. Decide how much your managers see." },
  { id: "team", title: "Your team", intro: "Add the people who work at the station and give each a role." },
] as const;
type StepId = (typeof STEPS)[number]["id"];

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const { supabase, profile } = await requireOwner();
  const settings = await getStationSettings();
  const { step: stepParam } = await searchParams;
  const index = Math.max(0, STEPS.findIndex((s) => s.id === stepParam));
  const step = STEPS[index];
  const previous = STEPS[index - 1];
  const following = STEPS[index + 1];
  const nextHref = following ? `/setup?step=${following.id}` : "/";
  const firstName = (profile.full_name || "").split(" ")[0];
  const firstVisit = !settings.setup_completed_at;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6 md:py-10">
      <header className="flex items-center justify-between gap-3">
        <div className="-ml-3 min-w-0">
          <Brand stationName={settings.station_name} />
        </div>
        {firstVisit ? (
          <ActionForm action={finishSetup} showSuccess={false} className="flex flex-col items-end gap-1">
            <SubmitButton
              className={`${buttonSecondary} ${buttonSmall}`}
              confirm="Skip the remaining questions? You can answer them any time in Settings."
            >
              Skip the rest
            </SubmitButton>
          </ActionForm>
        ) : (
          <Link href="/settings" className={`${buttonSecondary} ${buttonSmall}`}>
            Back to Settings
          </Link>
        )}
      </header>

      <div className="mt-6">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Step {index + 1} of {STEPS.length}
        </p>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={index + 1}
          className="mt-2 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800"
        >
          <div
            className="h-full rounded-full bg-zinc-900 transition-[width] dark:bg-zinc-50"
            style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
          />
        </div>
        <ol className="mt-3 hidden flex-wrap gap-x-3 gap-y-1 text-xs sm:flex">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <Link
                href={`/setup?step=${s.id}`}
                aria-current={i === index ? "step" : undefined}
                className={clsx(
                  "hover:underline",
                  i === index ? "font-semibold text-zinc-900 dark:text-zinc-50" : "text-zinc-500 dark:text-zinc-400",
                )}
              >
                {s.title}
              </Link>
            </li>
          ))}
        </ol>
      </div>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {index === 0 && firstVisit ? `Welcome${firstName ? `, ${firstName}` : ""}. Let's set up your station.` : step.title}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{step.intro}</p>

      <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 md:p-5">
        <StepContent step={step.id} supabase={supabase} settings={settings} me={profile.id} next={nextHref} />
      </section>

      <nav aria-label="Setup steps" className="mt-4 flex items-center justify-between gap-3">
        {previous ? (
          <Link href={`/setup?step=${previous.id}`} className={buttonSecondary}>
            Back
          </Link>
        ) : (
          <span />
        )}
        {/* Steps that are lists rather than one form move on with a link. */}
        {(step.id === "tanks" || step.id === "pumps") && (
          <Link href={nextHref} className={buttonPrimary}>
            Continue
          </Link>
        )}
        {step.id === "team" && (
          <ActionForm action={finishSetup} showSuccess={false} className="flex flex-col items-end gap-1">
            <SubmitButton>Finish and open the dashboard</SubmitButton>
          </ActionForm>
        )}
      </nav>
    </div>
  );
}

async function StepContent({
  step,
  supabase,
  settings,
  me,
  next,
}: {
  step: StepId;
  supabase: Supabase;
  settings: StationSettings;
  me: string;
  next: string;
}) {
  const save = "Save and continue";
  switch (step) {
    case "station":
      return <StationForm settings={settings} next={next} submitLabel={save} />;
    case "fuels": {
      const products = rows<FuelProduct>(await supabase.from("fuel_products").select("*").order("code"), "fuels");
      return <FuelSetupForm products={products} currency={settings.currency_code} next={next} />;
    }
    case "tanks":
      return <TanksSection equipment={await loadEquipment(supabase)} currency={settings.currency_code} />;
    case "pumps":
      return <PumpsSection equipment={await loadEquipment(supabase)} owner />;
    case "shifts":
      return <ShiftsForm shiftNames={settings.shift_names} next={next} submitLabel={save} />;
    case "payments":
      return <PaymentsForm settings={settings} next={next} submitLabel={save} />;
    case "sales":
      return <BarForm settings={settings} next={next} submitLabel={save} />;
    case "controls":
      return <ControlsForm settings={settings} next={next} submitLabel={save} />;
    case "access":
      return <AccessForm settings={settings} next={next} submitLabel={save} />;
    case "team": {
      const staff = rows<Profile>(await supabase.from("profiles").select("*").order("created_at"), "staff");
      const canCreate = canCreateAccounts();
      return (
        <div className="flex flex-col gap-5">
          <AddMemberForm canCreate={canCreate} signupUrl={signupUrl()} />
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Staff</h2>
            <MemberList staff={staff} me={me} canCreate={canCreate} />
          </div>
        </div>
      );
    }
  }
}
