import { api } from "@/lib/api/client";
import type { LoginResult, TokenPair } from "@/lib/contracts";

/**
 * Typed auth actions over the API client.
 *
 * All use the httpOnly-cookie refresh model: the server sets the rotating
 * refresh token as an httpOnly cookie (JS never sees it) and returns the
 * short-lived access token in the body. `credentials:"include"` on every
 * request (set in the client) carries that cookie. We never pass
 * `x-token-transport: body`, so the refresh token stays out of JS.
 */

/** Step 1 — email + password. Resolves to a token pair OR an MFA challenge. */
export function login(email: string, password: string, signal?: AbortSignal): Promise<LoginResult> {
  return api.post<LoginResult>("/v1/auth/login", { email, password }, { auth: false, signal });
}

/** Step 2 — complete an MFA-challenged login with a TOTP / recovery code. */
export function verifyMfa(mfaToken: string, code: string, signal?: AbortSignal): Promise<TokenPair> {
  return api.post<TokenPair>("/v1/auth/mfa/verify", { mfaToken, code }, { auth: false, signal });
}

/** Exchange the refresh cookie for a fresh access token (session bootstrap). */
export function refresh(signal?: AbortSignal): Promise<TokenPair> {
  return api.post<TokenPair>("/v1/auth/refresh", undefined, { auth: false, signal });
}

/** Revoke the current server-side session (clears the refresh cookie). */
export function logout(signal?: AbortSignal): Promise<void> {
  return api.post<void>("/v1/auth/logout", undefined, { signal });
}

/** Narrow a login result to the MFA-challenge branch. */
export function isMfaRequired(result: LoginResult): result is { mfaRequired: true; mfaToken: string } {
  return typeof result === "object" && result !== null && "mfaRequired" in result && result.mfaRequired === true;
}
