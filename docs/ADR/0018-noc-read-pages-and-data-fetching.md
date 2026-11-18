# ADR-0018 — NOC read pages: telecom read contract + data-fetching pattern

- **Status:** Accepted (owner-authorized Phase 12O-2f; implemented 2026-11-18)
- **Date:** 2026-11-18
- **Deciders:** Architect / Security / Frontend
- **Related:** ADR-0002 (contract-first), ADR-0015 (API client), ADR-0017
  (permission-aware nav). First read-only NOC (telecom control-plane) screen.

## Context

The NOC frontend is the goal of Phase 12O, but two things blocked it: the
OpenAPI contract covered only `/v1/auth/*` + `/v1/me/context` (zero telecom
endpoints — a long-tracked debt), and the frontend had no data-fetching pattern.
Contract-first (ADR-0002) forbids hand-written client types, so the contract
must describe an endpoint before the UI consumes it. The NOC is platform-only
(PlatformGuard on every telecom controller).

## Decision

Ship the smallest valuable NOC screen — a read-only **Engines overview** — and
with it the patterns the rest of the NOC reuses.

1. **Author the telecom read contract, incrementally.** Add only what this
   screen consumes: `GET /v1/telecom/engines` plus the `Engine`, `EngineHealth`,
   and `EngineCapabilities` schemas, authored from the real service response
   (`EnginesService.view`) with the real enum values — never invented. Types are
   regenerated (`pnpm gen:contracts`). Later NOC screens extend the contract the
   same way (engine `/status`, nodes, regions…).

2. **A thin `useResource` hook, not a data library.** `useResource(fetcher)`
   loads on mount + `reload()`, aborts on unmount, and surfaces the RFC 7807
   title on failure. Native `fetch` via the existing client — no react-query /
   swr (avoid deps; the NOC is read-mostly). The latest fetcher is captured by
   ref so an inline closure can't loop.

3. **Platform-aware nav + route gate.** `NavItem` gains a `platform` flag; the
   nav filter (`useVisibleNavItems`) and the `RouteGuard` both require the
   platform tenant for such items, on top of the permission. The NOC nav item
   ("Infrastructure", `/infrastructure`) is `platform: true` + `telecom.read`, so
   a non-platform member never sees or reaches it — matching the API's
   PlatformGuard.

4. **Read-only, honest, UX-gated.** The engines table shows real data with
   honest health (`UNKNOWN` for stub adapters — never fabricated) and honest
   loading/empty/error states. No mutations. The gate is UX; the API re-checks
   `telecom.read` + platform on every request.

## Options considered

1. **Hand-write telecom types / skip the contract.** Rejected — violates
   ADR-0002; the generated types keep the client honest to the server.
2. **Author the entire telecom surface at once.** Rejected — large and
   speculative; author per screen so every schema is backed by a consumer.
3. **Adopt react-query/swr for fetching.** Rejected for now — an unnecessary
   dependency for read-mostly NOC views; `useResource` is ~40 lines and enough.
4. **Engines overview + `useResource` + platform nav flag (chosen).**

## Consequences

- The long-standing "OpenAPI covers /v1/auth only" debt starts closing, one
  consumer-backed endpoint at a time.
- `useResource` is the reusable read pattern for every NOC screen; `RouteGuard`
  and `useVisibleNavItems` now understand platform-only modules.
- Covered by unit tests (`useResource` load/error/reload; `listEngines`;
  `EnginesView` rows/empty/error; nav + route-guard platform gating) and a
  production build. End-to-end (real engines, real health) is verifiable once
  the API runs and a platform member signs in.
- No backend/API/schema/DI change — the endpoint already existed; this only
  documents it in the contract and consumes it. Production stays on
  `NullEngineConnector`, so health reads `UNKNOWN`.

## Addendum — engine detail + live status (Phase 12O-2g, 2026-11-18)

Extends the NOC with a read-only engine detail screen, following the same
per-screen contract-authoring pattern.

- **Contract.** Authored `GET /v1/telecom/engines/{id}` (→ `Engine`) and
  `GET /v1/telecom/engines/{id}/status` (→ new `EngineStatus`) from the real
  `EnginesController.status` composition — honest health, `EngineConnection`
  (state ∈ UNCONFIGURED/DISABLED/BLOCKED/UNVERIFIED/REACHABLE/UNREACHABLE +
  endpointConfigured + detail), `EngineVersionPosture` (desired/applied short
  fingerprints, `syncState` ∈ NOOP/APPLIED/PENDING_RECONCILIATION/FAILED,
  snapshot count), and `EngineDesiredPreview` (version + per-kind counts). All
  from the real service shapes; `status` requires `telecom.health.read`.
- **UI.** `/infrastructure/[id]` → `<EngineDetailView>` loads the engine and its
  status with two `useResource` calls and renders identity + Health /
  Connectivity / Configuration-version / Desired-config cards. The engines table
  now links each name to its detail page. Read-only — the health-check and sync
  POSTs are **not** wired (they are mutations, out of the read-only NOC scope).
- Covered by unit tests (`getEngine`/`getEngineStatus`; detail view data + error)
  and a production build. No backend/API/schema/DI change; health stays `UNKNOWN`
  with the Null connector.