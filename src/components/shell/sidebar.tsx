"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import type { Role } from "@/lib/types";
import { Brand } from "./brand";
import { isActive, linksForRole } from "./nav-links";

export function Sidebar({ role, stationName }: { role: Role; stationName: string }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-zinc-200 bg-white px-3 py-4 dark:border-zinc-800 dark:bg-zinc-950 md:flex">
      <Brand stationName={stationName} />
      <nav className="mt-6 flex flex-1 flex-col gap-1" aria-label="Main">
        {linksForRole(role).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href, pathname) ? "page" : undefined}
            className={clsx(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive(href, pathname)
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
      <p className="px-3 text-xs text-zinc-400">SmartStation Pro</p>
    </aside>
  );
}
