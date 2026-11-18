# ADR-0016 — Auth frontend: sign-in gate + login/MFA flow

- **Status:** Accepted (owner-authorized Phase 12O-2c; implemented 2026-11-18)
- **Date:** 2026-11-18
- **Deciders:** Architect / Security / Frontend
- **Related:** ADR-0002 (frontend stack), ADR-0014 (`/v1/me/context`), ADR-0015
  (API client + session foundation). The backend auth contract (login / MFA /
  refresh / logout, httpOnly refresh cookie) is unchanged — this is frontend only.

## Context

ADR-0015 built the client + session foundation but mounted nothing. The app
still rendered its shell to everyone. We need interactive authentication: a way
to sign in (with MFA when enabled), a session that survives reload, sign-out,
and a gate so unauthenticated users never see the app chrome — all against the
existing `/v1/auth/*` endpoints, without weakening the server auth model.

## Decision

1. **Gate, not routes.** An `<AuthBoundary>` consumes the session status and
   renders: the app shell when `authenticated`; the sign-in screen when
   `unauthenticated` (401); a "no workspace" notice when `forbidden` (403, i.e.
   authenticated but no active membership); a retry notice on `error`; a loading
   notice while bootstrapping. No client-side route guards or redirects yet —
   permission-aware routing is a later slice. This keeps the first auth landing
   small and avoids a redirect/flash dance.

2. **Provider nesting.** `ThemeProvider` + `TooltipProvider` move up from
   `AppShell` into a new `<AppProviders>` so the sign-in screen and the shell
   both get theming; `SessionProvider` and `AuthBoundary` sit inside. `AppShell`
   now renders only for authenticated sessions.

3. **Login flow.** `LoginScreen` is a two-step form: email + password →
   `/v1/auth/login`; if the result is an MFA challenge, an authentication-code
   step → `/v1/auth/mfa/verify`. On success the access token goes into the
   in-memory store and the session reloads into the app. Errors surface the
   RFC 7807 `title` (and `detail`); the form is disabled while pending.

4. **Session persistence by refresh cookie.** On mount the provider bootstraps:
   if there is no in-memory access token (e.g. a page reload), it first calls
   `/v1/auth/refresh` (which uses the httpOnly refresh cookie) to mint a new
   access token, then loads `/v1/me/context`. The access token is never
   persisted in storage; reload-survival rides entirely on the httpOnly cookie.

5. **Sign-out** (`session.signOut`) calls `/v1/auth/logout` (revokes the server
   session + clears the cookie), clears the in-memory token, and drops to
   `unauthenticated`. It is reachable from the account menu.

6. **CSP.** The production `connect-src` gains the API origin, derived from
   `NEXT_PUBLIC_API_URL` so the policy and the client never drift; unset or
   same-origin collapses to `'self'`. No other CSP relaxation.

7. **New design-system primitives.** `Input`, `Label`, `Field` — the first form
   primitives — skinned to approved v0.1 tokens; focus uses the global
   `:focus-visible` ring. Needed because the library had only `Button`.

## Options considered

1. **Route-based protection (`/login` + redirects / middleware auth).** Deferred
   — needs client redirect choreography or server session reads in middleware;
   the gate is simpler and sufficient until permission-aware routing lands.
2. **Persist the access token for reload survival.** Rejected (ADR-0015) — XSS
   exfiltration risk; the httpOnly refresh cookie + `/v1/auth/refresh` is the
   correct mechanism and is what we use.
3. **Gate component under theme/tooltip (chosen).**

## Consequences

- The app now requires authentication to show the shell — a deliberate behavior
  change (the previous unauthenticated shell was a placeholder).
- `AppShell` lost its theme/tooltip providers (hoisted to `AppProviders`); its
  only caller is `AppProviders`. `UserMenu` now reads the live session.
- Server authority is unchanged: the gate and the session are UX only; every API
  route keeps its own authn/z. No backend/API/schema/DI change.
- Still deferred: password-reset + email-verification pages; permission-aware
  nav + route gating; MFA enroll/manage in account settings.
- Covered by unit tests (primitives; auth-actions; provider refresh-bootstrap +
  signOut; LoginScreen credentials/MFA/error; AuthBoundary states) and a
  production build. A full end-to-end login runs against the live API when the
  backend is up.

## Addendum — public token routes (Phase 12O-2d, 2026-11-18)

Implements the deferred password-reset and email-verification flows against the
existing endpoints (contract already covered them; no contract change).

- **Public routes, outside the gate.** `/reset-password` and `/verify-email`
  are reached from emailed links that carry a `?token=…`, so they must render
  for an unauthenticated visitor. The decision moves up to `<AppProviders>`:
  `isPublicAuthPath(usePathname())` (a tiny tested helper) selects a themed-but-
  bare render for those paths — **no `SessionProvider`, no gate, no shell** — so
  the token pages neither show app chrome nor fire a pointless session bootstrap.
  Every other path runs the full session + gate + shell as before.
- **Password reset.** One screen in two modes: no token → request form (`POST
  /v1/auth/password-reset/request`, always 202 — the UI shows a non-enumerating
  "if an account exists…" message); with token → set-new-password form (client
  checks length ≥ 12 and match, then `POST /v1/auth/password-reset/confirm`,
  which revokes all sessions server-side). Reached via a "Forgot password?" link
  on the sign-in screen.
- **Email verification.** `/verify-email` confirms the token on mount (`POST
  /v1/auth/email-verification/confirm`) and shows success/failure; a ref guards
  the StrictMode double-invoke. The authenticated *resend* action
  (`/v1/auth/email-verification/request`) ships in `auth-actions` but its in-app
  trigger is deferred — it needs `emailVerified`, which `/v1/me/context` does not
  carry (that belongs with an account/settings surface).
- Server authority unchanged; tokens travel only in POST bodies. The server
  never reveals account existence. Shared `AuthCard` + `messageFor` back all
  three screens (sign-in refactored onto them). Covered by unit tests
  (auth-actions ×4; reset request/confirm/validation/error; verify
  success/failure/no-token; `isPublicAuthPath`) and a production build; routes
  render-verified in the browser.
