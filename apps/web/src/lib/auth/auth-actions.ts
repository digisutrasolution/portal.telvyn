import { api } from "@/lib/api/client";
import type { LoginResult, Me, TokenPair } from "@/lib/contracts";

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

/** The current user's identity (id, email, mfaEnabled, emailVerified). */
export function getMe(signal?: AbortSignal): Promise<Me> {
  return api.get<Me>("/v1/auth/me", { signal });
}

/** Revoke the current server-side session (clears the refresh cookie). */
export function logout(signal?: AbortSignal): Promise<void> {
  return api.post<void>("/v1/auth/logout", undefined, { signal });
}

/** Narrow a login result to the MFA-challenge branch. */
export function isMfaRequired(result: LoginResult): result is { mfaRequired: true; mfaToken: string } {
  return typeof result === "object" && result !== null && "mfaRequired" in result && result.mfaRequired === true;
}

/**
 * Request a password-reset email. Always resolves (202) whether or not the
 * account exists — the server never reveals account existence (no enumeration).
 */
export function requestPasswordReset(email: string, signal?: AbortSignal): Promise<void> {
  return api.post<void>("/v1/auth/password-reset/request", { email }, { auth: false, signal });
}

/** Set a new password with a reset token (revokes all sessions server-side). */
export function confirmPasswordReset(token: string, newPassword: string, signal?: AbortSignal): Promise<void> {
  return api.post<void>("/v1/auth/password-reset/confirm", { token, newPassword }, { auth: false, signal });
}

/** Queue an email-verification message for the current user (authenticated). */
export function requestEmailVerification(signal?: AbortSignal): Promise<void> {
  return api.post<void>("/v1/auth/email-verification/request", undefined, { signal });
}

/** Confirm email ownership with a verification token. */
export function confirmEmailVerification(token: string, signal?: AbortSignal): Promise<void> {
  return api.post<void>("/v1/auth/email-verification/confirm", { token }, { auth: false, signal });
}
