import { LogOut } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import type { Profile } from "@/lib/types";
import { Brand } from "./brand";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  attendant: "Attendant",
  pending: "Pending approval",
};

export function Topbar({ profile, stationName }: { profile: Profile; stationName: string }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 md:px-6">
      <div className="-ml-3 min-w-0 md:hidden">
        <Brand stationName={stationName} />
      </div>
      <div className="hidden md:block" />
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 text-right">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {profile.full_name || profile.email}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{ROLE_LABELS[profile.role]}</p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </header>
  );
}
