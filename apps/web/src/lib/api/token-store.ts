/**
 * In-memory access-token store.
 *
 * Deliberately NOT localStorage / sessionStorage / IndexedDB: a bearer token
 * placed in any JS-readable storage is exfiltrable by a single XSS payload.
 * The short-lived access token lives only in this module's closure for the
 * life of the tab. The long-lived, rotating refresh token is an httpOnly
 * cookie the browser holds and JavaScript can never read (server auth model).
 *
 * Consequence (by design): a full-page reload clears the access token.
 * Re-bootstrapping the session from the refresh cookie is the job of the
 * login / session slice, not this store.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}
