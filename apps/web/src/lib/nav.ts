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
  /**
   * Backend permission key the viewer needs to see this module and open its
   * route (ADR-0017). Undefined = visible to any authenticated member (the
   * Operations landing). These keys exist in the server permission catalog;
   * the gate is UX only — every API route re-checks server-side.
   */
  permission?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Operations", href: "/", icon: Activity, phase: 16 },
  { label: "Numbers", href: "/numbers", icon: Hash, phase: 9, permission: "did.read" },
  { label: "Porting", href: "/porting", icon: ArrowLeftRight, phase: 9, queueKey: "porting", permission: "did.read" },
  { label: "Billing", href: "/billing", icon: Wallet, phase: 13, permission: "wallet.read" },
  // CDRs have no dedicated permission in the catalog yet; gated on billing's
  // wallet.read (usage is billing-adjacent) until a cdr.read key is introduced.
  { label: "CDRs", href: "/cdrs", icon: ListOrdered, phase: 14, permission: "wallet.read" },
  { label: "Admin", href: "/admin", icon: Settings, phase: 6, permission: "member.read" },
];

/** Find the nav item owning a pathname ("/numbers/x" → Numbers). */
export function navItemForPath(pathname: string): NavItem | undefined {
  if (pathname === "/") return NAV_ITEMS[0];
  return NAV_ITEMS.find(
    (item) => item.href !== "/" && (pathname === item.href || pathname.startsWith(`${item.href}/`)),
  );
}

/** The permission a pathname's module requires, or undefined if unguarded. */
export function requiredPermissionForPath(pathname: string): string | undefined {
  return navItemForPath(pathname)?.permission;
}
