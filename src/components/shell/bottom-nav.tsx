"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { isActive, linksFor, type NavContext } from "./nav-links";

/** Thumb-reachable navigation for phones. */
export function BottomNav({ nav }: { nav: NavContext }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 md:hidden"
    >
      {linksFor(nav).map(({ href, label, icon: Icon }) => {
        const active = isActive(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex min-w-0 flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium",
              active ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500 dark:text-zinc-400",
            )}
          >
            <Icon className={clsx("h-5 w-5", active && "stroke-[2.5]")} />
            <span className="max-w-full truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
