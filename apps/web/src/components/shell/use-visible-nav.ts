"use client";

import { NAV_ITEMS, type NavItem } from "@/lib/nav";
import { useSession } from "@/lib/session/session-context";

/**
 * Nav items the current session may see — the shared source for the sidebar,
 * the mobile sheet, and the command palette. An item shows only when the
 * session holds its `permission` (undefined = always visible) AND, for a
 * `platform` item (the NOC), the active tenant is the platform tenant.
 * UX gating only (ADR-0017/0018); the server re-checks every request.
 */
export function useVisibleNavItems(): NavItem[] {
  const { hasPermission, isPlatform } = useSession();
  return NAV_ITEMS.filter(
    (item) => (!item.permission || hasPermission(item.permission)) && (!item.platform || isPlatform),
  );
}
