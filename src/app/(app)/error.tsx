"use client";

import { AlertOctagon } from "lucide-react";
import { buttonSecondary } from "@/components/ui/styles";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-950">
      <AlertOctagon aria-hidden className="mx-auto h-8 w-8 text-critical" />
      <h1 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">This page could not load</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {error.message || "Something went wrong while loading station data."}
      </p>
      <p className="mt-2 text-xs text-zinc-400">
        If this is a new installation, check that the Supabase migrations have been applied.
      </p>
      <button type="button" onClick={reset} className={`${buttonSecondary} mt-5`}>
        Try again
      </button>
    </div>
  );
}
