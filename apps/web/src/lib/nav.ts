import {
  Activity,
  Hash,
  ArrowLeftRight,
  Waypoints,
  Cable,
  Route,
  Wallet,
  ListOrdered,
  Settings,
  Server,
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
  /**
   * Platform-only module (the NOC / telecom control plane, PlatformGuard on the
   * API). Shows and opens only for a PLATFORM-tenant session, combined with
   * `permission` (ADR-0018).
   */
  platform?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Operations", href: "/", icon: Activity, phase: 16 },
  { label: "Numbers", href: "/numbers", icon: Hash, phase: 9, permission: "did.read" },
  { label: "Porting", href: "/porting", icon: ArrowLeftRight, phase: 9, queueKey: "porting", permission: "did.read" },
  // Carriers / connectivity — tenant resource (own + system carriers); not platform-only.
  { label: "Carriers", href: "/carriers", icon: Waypoints, phase: 10, permission: "carrier.read" },
  // SIP trunks — strictly tenant-owned connectivity config (no live connectivity).
  { label: "SIP trunks", href: "/sip-trunks", icon: Cable, phase: 11, permission: "sip_trunk.read" },
  // Routing — tenant-owned declarative routing profiles (config only, not executed).
  { label: "Routing", href: "/routing", icon: Route, phase: 12, permission: "routing.read" },
  { label: "Billing", href: "/billing", icon: Wallet, phase: 13, permission: "wallet.read" },
  // CDRs / usage gate on their own catalog key (billing-adjacent). Granted to the
  // billing-visible roles (owner, operator, auditor); routes land in Phase 14.
  { label: "CDRs", href: "/cdrs", icon: ListOrdered, phase: 14, permission: "cdr.read" },
  // NOC / telecom control plane — platform-only (PlatformGuard on the API).
  { label: "Infrastructure", href: "/infrastructure", icon: Server, phase: 12, permission: "telecom.read", platform: true },
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
