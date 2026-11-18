"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { requiredPermissionForPath } from "@/lib/nav";
import { useSession } from "@/lib/session/session-context";

/** Shown when the session lacks the permission a route requires. */
function RouteDenied() {
  return (
    <section
      aria-label="Access restricted"
      className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface px-8 py-14 text-center shadow-elev-1"
    >
      <ShieldOff aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
      <h1 className="font-display text-[19px] font-semibold">Access restricted</h1>
      <p className="text-[13px] text-ink-2">
        You don&apos;t have permission to view this area. Ask a workspace administrator if you need access.
      </p>
    </section>
  );
}

/**
 * Permission gate for the current route (ADR-0017). Derives the required
 * permission from the nav config and renders the page only when the session
 * holds it; otherwise an honest "access restricted" state. UX gating only —
 * the API re-checks every request, so this never guards data, only the view.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { hasPermission } = useSession();
  const required = requiredPermissionForPath(pathname);

  if (required && !hasPermission(required)) {
    return <RouteDenied />;
  }
  return <>{children}</>;
}
