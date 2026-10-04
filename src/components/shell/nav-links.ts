import {
  BookOpenCheck,
  Fuel,
  Gauge,
  LayoutDashboard,
  Martini,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { Role } from "@/lib/types";

export interface NavLink {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  managerOnly?: boolean;
  ownerOnly?: boolean;
}

export const navLinks: NavLink[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/shifts", label: "Shifts", icon: Gauge },
  { href: "/tanks", label: "Tanks", icon: Fuel },
  { href: "/bar", label: "Bar", icon: Martini },
  { href: "/accounting", label: "Accounts", icon: BookOpenCheck, managerOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, managerOnly: true },
  { href: "/activity", label: "Activity", icon: ShieldCheck, ownerOnly: true },
];

export function linksForRole(role: Role) {
  const manager = role === "owner" || role === "manager";
  return navLinks.filter((link) => (role === "owner" || !link.ownerOnly) && (manager || !link.managerOnly));
}

export function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
