import { NextRequest, NextResponse } from "next/server";

/**
 * Nonce-based Content-Security-Policy (pre-Phase-12 hardening).
 *
 * PRODUCTION ONLY: a strict, per-request nonce CSP. Next.js reads the nonce
 * from the request's `content-security-policy` header and stamps it onto its
 * own inline scripts (hydration/RSC flight); next-themes gets the same nonce
 * via a prop in the root layout. `style-src 'unsafe-inline'` is technically
 * necessary — Radix UI writes inline style attributes and cannot carry a
 * nonce; script stays nonce-locked, which is where XSS risk actually lives.
 * No `unsafe-eval`, no `unsafe-inline` for scripts.
 *
 * DEVELOPMENT: no CSP — Next dev/HMR relies on eval and inline scripts, and a
 * strict policy would break the dev server. The non-CSP headers (HSTS in prod,
 * Permissions-Policy, frame/referrer/nosniff) live in next.config.ts and apply
 * in both environments.
 *
 * connect-src is 'self' only today (the shell makes no cross-origin calls).
 * When the auth frontend (next phase) calls the API on another origin, add the
 * API origin to connect-src here. See docs/SECURITY.md.
 */
export function middleware(request: NextRequest): NextResponse {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Apply to documents; skip static assets and the image optimizer.
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
