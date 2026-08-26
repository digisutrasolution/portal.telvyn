import {
  Activity,
  Hash,
  ArrowLeftRight,
  Wallet,
  ListOrdered,
  Settings,
  type LucideIcon,
} from "lucide-react";

/**
 * Primary navigation config — the single source for the sidebar, breadcrumbs,
 * and command palette. Roadmap phase numbers gate which modules have real
 * pages; the shell renders honest "ships in Phase N" states until then.
 */
export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Roadmap phase that delivers this module's real screens. */
  phase: number;
  /** Optional queue-count key resolved by the telemetry seam (Phase 16). */
  queueKey?: "porting" | "provisioning";
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Operations", href: "/", icon: Activity, phase: 16 },
  { label: "Numbers", href: "/numbers", icon: Hash, phase: 9 },
  { label: "Porting", href: "/porting", icon: ArrowLeftRight, phase: 9, queueKey: "porting" },
  { label: "Billing", href: "/billing", icon: Wallet, phase: 13 },
  { label: "CDRs", href: "/cdrs", icon: ListOrdered, phase: 14 },
  { label: "Admin", href: "/admin", icon: Settings, phase: 6 },
];

/** Find the nav item owning a pathname ("/numbers/x" → Numbers). */
export function navItemForPath(pathname: string): NavItem | undefined {
  if (pathname === "/") return NAV_ITEMS[0];
  return NAV_ITEMS.find(
    (item) => item.href !== "/" && (pathname === item.href || pathname.startsWith(`${item.href}/`)),
  );
}
