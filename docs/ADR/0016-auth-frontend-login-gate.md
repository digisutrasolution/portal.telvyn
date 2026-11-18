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
