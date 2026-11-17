# ADR-0015 — Frontend typed API client + contract type generation

- **Status:** Accepted (owner-authorized Phase 12O-2b; implemented 2026-11-18)
- **Date:** 2026-11-18
- **Deciders:** Architect / Security / Frontend
- **Related:** ADR-0002 (contract-first; frontend stack), ADR-0004 (server-derived
  tenant context), ADR-0014 (`/v1/me/context`). Foundation for the NOC auth
  frontend (Phase 12O-2c+: login/MFA pages, permission-aware nav).

## Context

The web app (`apps/web`) had no data layer: no API client, no session state, no
typed contract — only `SHELL_CONFIG` placeholder seams. ADR-0002 mandates
contract-first ("clients/types are generated from the contract, never
hand-written"), but no generator was installed, and the constitution says to
avoid unnecessary dependencies. Before any screen can talk to the API we need:
a single typed egress point, a safe place to hold the access token, and a way
for the UI to learn what the session may do.

## Decision

Build a **client + session foundation only** (no UI, no CSP change, not yet
mounted into the shell):

1. **Contract types are generated, not hand-written.** Add `openapi-typescript`
   as a web dev dependency and a `pnpm gen:contracts` script that regenerates
   `apps/web/src/lib/contracts/schema.ts` from the single canonical contract
   `packages/contracts/openapi/telvyn.v1.yaml`. The generated file is committed
   (reviewable diffs; reproducible) and never edited by hand. `contracts/index.ts`
   re-exports ergonomic aliases (`MeContext`, `Role`, `Problem`). Output lives in
   the web tree because web is the only consumer today and `packages/contracts`
   is not yet a published package — wiring a cross-package build for one consumer
   would be unnecessary scaffolding. It can move into the contracts package later
   without changing the canonical source.

2. **Centralized typed `fetch` client** (`lib/api/client.ts`): base URL from
   `NEXT_PUBLIC_API_URL` (default `http://localhost:3311`); attaches the bearer
   access token (opt-out `auth:false`); `credentials:"include"` so the httpOnly
   refresh cookie flows to `/v1/auth` later; one `AbortSignal` fanning in a
   per-request timeout (15s default) and caller cancellation; non-2xx throws a
   typed `ApiError` carrying the parsed RFC 7807 `problem+json` body. **No
   automatic retry** — a failed mutation is never silently replayed
   (double-POST / toll-fraud risk); refresh-driven retry of idempotent reads is
   a later, explicit concern. No data-fetching library (axios/swr/react-query) —
   native `fetch` suffices.

3. **In-memory access-token store** (`lib/api/token-store.ts`): the access token
   lives only in a module closure, **never** in localStorage/sessionStorage/
   IndexedDB — a token in JS-readable storage is exfiltrable by any XSS. The
   long-lived rotating refresh token stays an httpOnly cookie JS cannot read
   (server auth model). A full-page reload clears the access token by design;
   re-bootstrapping from the refresh cookie is the login/session slice's job.

4. **`SessionProvider` + `useSession`** (`lib/session/session-context.tsx`):
   loads `GET /v1/me/context` (ADR-0014) on mount and exposes
   `{ status, context, isPlatform, hasPermission, hasAnyPermission,
   hasAllPermissions, reload }`. Status distinguishes `loading` /
   `authenticated` / `unauthenticated` (401) / `forbidden` (403) / `error`. The
   loader is injectable so tests need no network. Permission helpers are **UX
   only** — the server guards remain the sole authority; these never make an
   authorization decision. Permissions are exact-match set lookups because the
   server already expanded wildcards.

## Options considered

1. **Hand-write the type surface** — rejected: violates ADR-0002 and drifts from
   the contract over time.
2. **A heavier client+codegen stack (orval / hey-api + react-query)** — rejected
   for now: unnecessary dependencies for a read-mostly bootstrap; native `fetch`
   + a thin wrapper meets every requirement.
3. **Persist the access token in storage for reload survival** — rejected on
   security grounds (XSS exfiltration); the httpOnly refresh cookie is the
   correct reload-survival mechanism, handled in a later slice.
4. **`openapi-typescript`, generated into the web tree, in-memory token, native
   fetch (chosen).**

## Consequences

- Additive and isolated: new `lib/contracts`, `lib/api`, `lib/session` modules
  plus one devDependency and a `gen:contracts` script. Nothing existing changed;
  the foundation is **not yet mounted** into the shell, so there is no runtime
  behavior change and no CSP change yet.
- When the contract changes, run `pnpm gen:contracts`; CI should run it and fail
  on a dirty tree (follow-up, not this slice) to guarantee the committed types
  match the spec.
- The next slice (12O-2c) mounts `SessionProvider`, adds login/MFA pages and
  permission-aware nav, and extends the frontend CSP `connect-src` to the API
  origin (today still `'self'` — the standing comment in `middleware.ts`).
- Covered by 20 unit tests (token store; client happy-path, 204, bearer
  attach/omit, JSON body, problem+json → `ApiError`, synthesized problem,
  timeout, caller-cancel, no-retry; provider authenticated/platform/401/403/
  error/reload/guard).
