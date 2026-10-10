import {
  BookOpenCheck,
  Fuel,
  Gauge,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Store,
} from "lucide-react";
import type { Role } from "@/lib/types";

export interface NavLink {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  managerOnly?: boolean;
  ownerOnly?: boolean;
  /** For those who may see the accounts or use the cash book. */
  money?: boolean;
  /** The bar module, named and switched on or off by the owner. */
  bar?: boolean;
}

/** Who is looking, and how the station is set up. */
export interface NavContext {
  role: Role;
  money: boolean;
  bar: { enabled: boolean; name: string };
}

export const navLinks: NavLink[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/shifts", label: "Shifts", icon: Gauge },
  { href: "/tanks", label: "Tanks", icon: Fuel },
  { href: "/bar", label: "Bar", icon: Store, bar: true },
  { href: "/accounting", label: "Accounts", icon: BookOpenCheck, managerOnly: true, money: true },
  { href: "/settings", label: "Settings", icon: Settings, managerOnly: true },
  { href: "/activity", label: "Activity", icon: ShieldCheck, ownerOnly: true },
];

export function linksFor({ role, money, bar }: NavContext): NavLink[] {
  const manager = role === "owner" || role === "manager";
  return navLinks
    .filter(
      (link) =>
        (role === "owner" || !link.ownerOnly) &&
        (manager || !link.managerOnly) &&
        (money || !link.money) &&
        (bar.enabled || !link.bar),
    )
    .map((link) => (link.bar ? { ...link, label: bar.name } : link));
}

export function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
