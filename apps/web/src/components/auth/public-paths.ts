/**
 * Routes that render WITHOUT an authenticated session — they carry their own
 * token from an emailed link (password reset, email verification). These bypass
 * the session provider, the auth gate, and the app shell entirely (Phase
 * 12O-2d); they render themed but bare.
 */
export const PUBLIC_AUTH_PATHS: ReadonlySet<string> = new Set(["/reset-password", "/verify-email"]);

export function isPublicAuthPath(pathname: string | null | undefined): boolean {
  return !!pathname && PUBLIC_AUTH_PATHS.has(pathname);
}
