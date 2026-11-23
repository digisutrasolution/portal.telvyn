"use client";

import * as React from "react";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/problem";
import { clearAccessToken, getAccessToken, setAccessToken } from "@/lib/api/token-store";
import { logout as logoutAction, refresh } from "@/lib/auth/auth-actions";
import type { MeContext } from "@/lib/contracts";

/**
 * Session + authorization context for the frontend.
 *
 * On mount it bootstraps the session: if there is no in-memory access token
 * (e.g. a fresh page load), it first exchanges the httpOnly refresh cookie for
 * a new access token, then loads the server-derived authorization context from
 * GET /v1/me/context (ADR-0014). The context + permission helpers drive UX
 * only — permission-aware nav and route gating. They are NEVER an authorization
 * decision: every API route keeps its own server-side permission + platform
 * checks, which remain the authority. Permissions arrive already expanded to
 * concrete keys, so `hasPermission` is a plain set lookup.
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
  /** Re-run the bootstrap (e.g. after a successful login). */
  reload: () => void;
  /** Revoke the server session, clear the access token, drop to unauthenticated. */
  signOut: () => Promise<void>;
}

/** Loads the authorization context. Injectable so tests need no network. */
export type SessionLoader = (signal: AbortSignal) => Promise<MeContext>;

/**
 * Raised when the session gate (the refresh exchange) says "not signed in" — an
 * HTTP 401, or an HTTP 400 for a missing/invalid refresh token. The provider maps
 * it to `unauthenticated` (→ the sign-in screen), NOT to a connectivity error.
 * The backend returns 400 on a missing refresh cookie; we do not change that — we
 * classify it correctly on the client.
 */
export class UnauthenticatedError extends Error {
  constructor() {
    super("No valid session");
    this.name = "UnauthenticatedError";
  }
}

/** Default bootstrap: refresh (if needed) → fetch context. */
export const defaultSessionLoader: SessionLoader = async (signal) => {
  if (!getAccessToken()) {
    let pair: Awaited<ReturnType<typeof refresh>>;
    try {
      pair = await refresh(signal);
    } catch (err) {
      // The refresh exchange IS the session gate: a 401 — or a 400 for a
      // missing/invalid refresh token — means "not signed in" → show sign-in.
      // Real failures (5xx, network, aborted) propagate unchanged → error.
      if (err instanceof ApiError && (err.status === 400 || err.status === 401)) {
        throw new UnauthenticatedError();
      }
      throw err;
    }
    setAccessToken(pair.accessToken);
  }
  return api.get<MeContext>("/v1/me/context", { signal });
};

const SessionCtx = React.createContext<SessionState | null>(null);

export function SessionProvider({
  children,
  loader = defaultSessionLoader,
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
        if (err instanceof UnauthenticatedError || (err instanceof ApiError && err.status === 401))
          setStatus("unauthenticated");
        else if (err instanceof ApiError && err.status === 403) setStatus("forbidden");
        else setStatus("error");
      });
    return () => {
      active = false;
      ac.abort();
    };
  }, [loader, reloadKey]);

  const permissions = React.useMemo(() => new Set(context?.permissions ?? []), [context]);

  const signOut = React.useCallback(async () => {
    try {
      await logoutAction();
    } catch {
      // Best-effort: even if the server call fails, drop local auth state.
    } finally {
      clearAccessToken();
      setContext(null);
      setStatus("unauthenticated");
    }
  }, []);

  const value = React.useMemo<SessionState>(
    () => ({
      status,
      context,
      isPlatform: context?.tenantType === "PLATFORM",
      hasPermission: (key) => permissions.has(key),
      hasAnyPermission: (...keys) => keys.some((k) => permissions.has(k)),
      hasAllPermissions: (...keys) => keys.every((k) => permissions.has(k)),
      reload: () => setReloadKey((n) => n + 1),
      signOut,
    }),
    [status, context, permissions, signOut],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionState {
  const ctx = React.useContext(SessionCtx);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
