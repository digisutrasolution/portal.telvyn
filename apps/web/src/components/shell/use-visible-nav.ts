"use client";

import { NAV_ITEMS, type NavItem } from "@/lib/nav";
import { useSession } from "@/lib/session/session-context";

/**
 * Nav items the current session may see — the shared source for the sidebar,
 * the mobile sheet, and the command palette. An item with no `permission` is
 * always visible; otherwise it shows only when the session holds that key.
 * UX gating only (ADR-0017); the server re-checks every request.
 */
export function useVisibleNavItems(): NavItem[] {
  const { hasPermission } = useSession();
  return NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));
}
