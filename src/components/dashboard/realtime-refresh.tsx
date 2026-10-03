"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { createClient } from "@/lib/supabase/client";

type Status = "connecting" | "live" | "offline";

/**
 * Subscribes to Supabase Realtime changes on the given tables and re-renders
 * the page's server components when anything changes.
 */
export function RealtimeRefresh({ tables, channel }: { tables: readonly string[]; channel: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("connecting");
  const tableKey = tables.join(",");

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 500);
    };

    const subscription = tableKey.split(",").reduce(
      (ch, table) => ch.on("postgres_changes", { event: "*", schema: "public", table }, refresh),
      supabase.channel(channel),
    );
    subscription.subscribe((state) => {
      if (state === "SUBSCRIBED") setStatus("live");
      else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") setStatus("offline");
    });

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(subscription);
    };
  }, [router, channel, tableKey]);

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400"
      title={status === "live" ? "Updates appear automatically" : "Refresh the page to see new data"}
    >
      <span
        aria-hidden
        className={clsx(
          "h-2 w-2 rounded-full",
          status === "live" && "bg-good",
          status === "connecting" && "bg-zinc-300 dark:bg-zinc-600",
          status === "offline" && "bg-serious",
        )}
      />
      {status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Offline"}
    </span>
  );
}
