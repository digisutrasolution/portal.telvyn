"use client";

import * as React from "react";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/problem";
import type { MeContext } from "@/lib/contracts";

/**
 * Session + authorization context for the frontend.
 *
 * On mount it loads the server-derived authorization context from
 * GET /v1/me/context (ADR-0014) and exposes it, plus permission helpers, to
 * the tree. These helpers drive UX only — permission-aware nav and route
 * gating. They are NEVER an authorization decision: every API route keeps its
 * own server-side permission + platform checks, which remain the authority.
 *
 * Permissions arrive already expanded to concrete keys (the server resolves
 * wildcards such as an owner's "*"), so `hasPermission` is a plain set lookup.
 */
export type SessionStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated" // 401: no (or no longer a) valid session
  | "forbidden" // 403: authenticated, but no active tenant / membership
  | "error"; // network / unexpected failure

export interface SessionState {
  status: SessionStatus;
  context: MeContext | null;
  /** True when the active tenant is the platform tenant (the NOC surface). */
  isPlatform: boolean;
  /** Exact-match against the expanded permission set. */
  hasPermission: (key: string) => boolean;
  hasAnyPermission: (...keys: string[]) => boolean;
  hasAllPermissions: (...keys: string[]) => boolean;
  /** Re-fetch the context (e.g. after login or a tenant switch). */
  reload: () => void;
}

/** Loads the authorization context. Injectable so tests need no network. */
export type SessionLoader = (signal: AbortSignal) => Promise<MeContext>;

const defaultLoader: SessionLoader = (signal) => api.get<MeContext>("/v1/me/context", { signal });

const SessionCtx = React.createContext<SessionState | null>(null);

export function SessionProvider({
  children,
  loader = defaultLoader,
}: {
  children: React.ReactNode;
  loader?: SessionLoader;
}) {
  const [status, setStatus] = React.useState<SessionStatus>("loading");
  const [context, setContext] = React.useState<MeContext | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    const ac = new AbortController();
    let active = true;
    setStatus("loading");
    loader(ac.signal)
      .then((ctx) => {
        if (!active) return;
        setContext(ctx);
        setStatus("authenticated");
      })
      .catch((err: unknown) => {
        if (!active || ac.signal.aborted) return;
        setContext(null);
        if (err instanceof ApiError && err.status === 401) setStatus("unauthenticated");
        else if (err instanceof ApiError && err.status === 403) setStatus("forbidden");
        else setStatus("error");
      });
    return () => {
      active = false;
      ac.abort();
    };
  }, [loader, reloadKey]);

  const permissions = React.useMemo(() => new Set(context?.permissions ?? []), [context]);

  const value = React.useMemo<SessionState>(
    () => ({
      status,
      context,
      isPlatform: context?.tenantType === "PLATFORM",
      hasPermission: (key) => permissions.has(key),
      hasAnyPermission: (...keys) => keys.some((k) => permissions.has(k)),
      hasAllPermissions: (...keys) => keys.every((k) => permissions.has(k)),
      reload: () => setReloadKey((n) => n + 1),
    }),
    [status, context, permissions],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionState {
  const ctx = React.useContext(SessionCtx);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
