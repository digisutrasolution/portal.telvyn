# PROJECT_STATE.md — Telvyn DID Portal PROMAX

> **The living status document. Read this first, every session; update it at the
> end of every session.**

## Status taxonomy (used across ALL docs)

| Tag | Meaning |
|---|---|
| **EXISTING** | Verifiably present in this repository today |
| **PLANNED** | Committed by the constitution (`CLAUDE.md`) or an Accepted ADR — not yet built |
| **PROPOSED** | Recommendation on the table; needs an ADR/owner decision to become PLANNED |
| **UNKNOWN** | Cannot be determined from the repository; needs owner input |

## Identity

| Attribute | Value | Status |
|---|---|---|
| Product | Telvyn DID Portal PROMAX | EXISTING (per constitution) |
| Domain | portal.telvyn.co | EXISTING (decision) / not yet live |
| Repository | D:\Claude Dev\portal.telvyn.co | EXISTING |
| Lineage | Fully independent product & codebase — ADR-0001 | EXISTING (Accepted) |
| Started | 2026-08-26 | — |

## Current phase

**Phase 12M COMPLETE — real Kamailio engine adapter delivered and LIVE-PROVEN.** The
`KamailioJsonRpcConnector` was validated end-to-end against the disposable Kamailio 6.1.5
test engine (dedicated VPS `167.114.98.53`) with no mocks: vault decrypt →
`NodeHttpsEngineTransport` (mTLS + rebinding recheck) → nginx mTLS gateway (`wg0:8443`)
over WireGuard → Kamailio JSONRPC `core.version` → **HEALTHY** (~750ms). Default remains
`NullEngineConnector` (no egress) until `ENGINE_CONNECTOR=kamailio`. Management plane is
PRIVATE; SIP/RTP stay closed. Opt-in live test + ops script committed; RUNBOOK documents
the full procedure. **API 255/255 (+1 opt-in live PASS, skipped by default), web 13/13**,
typecheck ✓, lint ✓, build ✓.

**Phase 12N IN PROGRESS — engine↔resource assignment model** (the prerequisite for a
real `applyConfiguration`). Sub-phases: **12N-1 (DONE)** additive schema —
`EngineResourceAssignment` (engine + sip-trunk/DID/routing-profile + tenant FKs; DB CHECK
exactly-one-resource-matching-kind; per-kind unique; `enabled`+soft-delete) + ADR-0012;
**12N-2 (DONE)** assignment service + platform API (`/v1/telecom/engines/:id/assignments`,
PlatformGuard) + RBAC + audit + server-derived tenantId + reactivate-on-reassign; **12N-3
(DONE)** wire assignments into `buildConfigurationIntent` (non-empty intent / real fingerprint;
live `desired` preview on `GET :id/status`); **12N-4a (DONE)** applied-version persistence +
reconciliation state machine (APPLIED / PENDING_RECONCILIATION-on-timeout / FAILED; snapshot
route, no migration, no engine mutation); **12N-4b (DONE — mechanism; live mutation gated)**
the real `applyConfiguration` = Kamailio **htable diff-and-apply** (dump→diff→sets/delete→
re-dump verify) per **ADR-0013 Accepted**, off by default (`NullEngineConnector`), unit-tested
via a fake transport + an opt-in live mutating test. After 12N-4b: **API 291/291, web 13/13**,
typecheck ✓, lint ✓. **LIVE-VALIDATED 2026-11-17** (operator-authorized) against the
disposable Kamailio 6.1.5 VPS: apply → verify → idempotent (0-op) → rollback-to-empty, htable
left clean. **Phase 12N COMPLETE.** Production stays on `NullEngineConnector` (`ENGINE_CONNECTOR`
unset).

**Phase 12O IN PROGRESS — NOC frontend enablement.** **12O-1 (DONE — planning/inspection only)**
confirmed the frontend has no auth/session/API-client/data layer (only `SHELL_CONFIG` seams) and
that the single hard prerequisite for permission-aware UI was a server endpoint exposing the
session's `tenantType` + permission set (none existed: `/v1/auth/me` is identity-only,
`/v1/permissions` is the catalog). **12O-2a (DONE)** delivers that prerequisite: read-only
`GET /v1/me/context` → `{ userId, tenantId, tenantType, roles[], permissions[] }` from the
server-derived tenant context (ADR-0004, **ADR-0014 Accepted**). No `@RequirePermissions` (called
at bootstrap before permissions are known); JwtAuthGuard + TenantGuard still require a live active
membership; permissions are expanded/concrete/sorted (owner's `*` resolved, never raw). Additive
only — no schema/migration/DI-default/API-auth change. **API 296/296 (+2 skipped), web 13/13,
typecheck ✓.** **12O-2b (DONE)** — the web app's first data layer, **client + session foundation
only** (NO UI, NO CSP change, NOT yet mounted into the shell). Contract-first per ADR-0002: added
`openapi-typescript` (web devDep) + a `gen:contracts` script generating
`apps/web/src/lib/contracts/schema.ts` from the canonical `telvyn.v1.yaml` (committed, never
hand-edited). New modules under `apps/web/src/lib/`: `api/client.ts` (centralized typed `fetch` —
bearer attach, `credentials:include` for the later refresh cookie, timeout + caller cancellation on
one AbortSignal, non-2xx → typed `ApiError` carrying RFC 7807 `problem+json`, **no auto-retry**);
`api/token-store.ts` (**in-memory** access token only — never localStorage, XSS defense);
`api/problem.ts`; `session/session-context.tsx` (`SessionProvider`/`useSession` loading
`GET /v1/me/context`, exposing `status`/`isPlatform`/`hasPermission`-family/`reload`, loader
injectable for tests; permission helpers are **UX-only**, server guards stay authoritative).
**ADR-0015 Accepted. web 13 → 33 tests, typecheck ✓, lint ✓.** `next build` deferred to the mount
slice (modules not imported by any route yet; a dev server also holds `.next`). Production stays on
`NullEngineConnector`. **12O-2c (DONE)** — auth frontend: the session layer is **mounted** and the
app now **requires authentication**. New `<AuthBoundary>` gates the shell on session status
(authenticated → app; unauthenticated → sign-in; forbidden → no-workspace; error → retry; loading);
`ThemeProvider`/`TooltipProvider` hoisted from `AppShell` into a new `<AppProviders>`. `LoginScreen`
(email+password → `/v1/auth/login`, MFA code → `/v1/auth/mfa/verify`) stores the access token in
memory and reloads the session; `SessionProvider` gained **refresh-on-bootstrap** (`/v1/auth/refresh`
via the httpOnly cookie restores the session on reload — token never stored) and `signOut`
(`/v1/auth/logout`, wired into the account menu). CSP `connect-src` += API origin (from
`NEXT_PUBLIC_API_URL`). First form primitives: `Input`/`Label`/`Field` (v0.1 tokens). `distDir`
env-overridable (`NEXT_DIST_DIR`) for building beside a live dev server. **No backend/API/schema/DI
change** — server authn/z stays the authority (gate is UX only). **ADR-0016 Accepted. web 33 → 53
tests, typecheck ✓, lint ✓, `next build` ✓**, live browser check passed (gate render + graceful
API-down state, no console errors). **12O-2d (DONE)** — password reset + email verification flows.
New **public** routes `/reset-password` + `/verify-email` (reached from emailed `?token=` links)
render themed but **bare** — no session provider, gate, or shell; the decision lives in
`<AppProviders>` via a tested `isPublicAuthPath(usePathname())` helper. `ResetPasswordScreen`
(request mode: non-enumerating 202; token mode: client-validate ≥12 + match → confirm, server revokes
all sessions) reached from a "Forgot password?" link; `VerifyEmailScreen` confirms on mount
(StrictMode-guarded) → success/failure. 4 new `auth-actions`; shared `AuthCard`/`messageFor` adopted
by sign-in too. Email-verification *resend* action exists but its in-app trigger is deferred (needs
`emailVerified`, absent from `/v1/me/context`). Contract already covered these endpoints (no change).
`.next-build/` added to eslint ignores. **No backend/API/schema/DI change.** **web 53 → 69 tests,
typecheck ✓, lint ✓, `next build` ✓**; routes render-verified bare in the browser. ADR-0016 addendum.
Production stays on `NullEngineConnector`. **12O-2e (DONE)** — permission-aware nav + route gating.
`NavItem` gains a `permission` key (real catalog keys, owner-approved map): Numbers/Porting →
`did.read`, Billing/CDRs → `wallet.read` (CDRs provisional, no `cdr.read` yet), Admin → `member.read`,
Operations landing unguarded. `useVisibleNavItems()` hook filters the sidebar, mobile sheet, and
command palette from one source; a central `<RouteGuard>` wraps the shell `<main>` and gates every
module route by `requiredPermissionForPath` (page when allowed, else "Access restricted"). **UX gating
only** — API re-checks every request. **ADR-0017 Accepted. web 69 → 77 tests, typecheck ✓, lint ✓,
`next build` ✓** (nav/guard behavior is unit-tested + build-verified; end-to-end per-role needs the API
up + a signed-in member). **12O-2f (DONE)** — first NOC screen: read-only **Engines overview** +
telecom read contract. Contract-first: authored `GET /v1/telecom/engines` + `Engine`/`EngineHealth`/
`EngineCapabilities` into `telvyn.v1.yaml` from the real `EnginesService.view` (begins closing the
OpenAPI /v1/auth-only debt), regenerated types. New `useResource(fetcher)` hook (native fetch, load +
`reload()`, abort, RFC 7807 error — no react-query), `listEngines()` action, `<EnginesView>` table
(status/health badges, honest loading/empty/error; health `UNKNOWN` for stubs, never fabricated).
Platform-aware nav: `NavItem.platform` flag; `useVisibleNavItems` + `RouteGuard` require the platform
tenant for such items on top of the permission. New "Infrastructure" nav + `/infrastructure` route
(`platform:true` + `telecom.read`) — matches API PlatformGuard. **UX-gated; API re-checks.** **ADR-0018
Accepted. web 77 → 91 tests, typecheck ✓, lint ✓, `next build` ✓** (unit + build; end-to-end needs API
up + platform sign-in). **No backend/API/schema/DI change.** Production stays on `NullEngineConnector`
(health reads UNKNOWN). **12O-2g (DONE)** — NOC engine detail + live status. Contract-first: authored
`GET /v1/telecom/engines/{id}` (→ `Engine`) + `/{id}/status` (→ `EngineStatus` + `EngineConnection`/
`EngineVersionPosture`/`EngineDesiredPreview`) from the real `EnginesController.status` composition,
regenerated types. `getEngine`/`getEngineStatus`; `/infrastructure/[id]` → `<EngineDetailView>` (two
`useResource` calls → Health / Connectivity / Configuration-version / Desired-config cards); engines
table name links to detail. Honest UNKNOWN health / UNCONFIGURED connection with Null connector.
**Read-only** (health-check/sync POSTs not wired). **ADR-0018 addendum. web 91 → 95 tests, typecheck ✓,
lint ✓, `next build` ✓** (both /infrastructure routes). **No backend/API/schema/DI change.** Production
stays on `NullEngineConnector`. **12O-2h (DONE)** — NOC nodes + regions + section sub-nav. Contract-
first: authored `GET /v1/telecom/regions` (→ `Region`) + `/v1/telecom/nodes` (→ `Node` + `NodeHealth`)
from the real service views, regenerated types. `listRegions`/`listNodes`; `<RegionsView>` +
`<NodesView>` read-only tables (honest UNKNOWN health). New `app/infrastructure/layout.tsx` + `<InfraTabs>`
(Engines/Nodes/Regions sub-nav); nodes/regions = static sibling routes, engines at `/infrastructure`
(detail `[id]`). Platform-gated. **ADR-0018 addendum. web 95 → 107 tests, typecheck ✓, lint ✓,
`next build` ✓** (all four /infrastructure routes). **No backend/API/schema/DI change.** Production
stays on `NullEngineConnector`. Next (await owner go): mutating NOC actions (health-check POST
:id/health-check, sync POST :id/sync — first NOC mutations, need confirm/step-up); then MFA
enroll/manage + email-unverified banner + `cdr.read`; carrier/sip-trunk/did/routing/lcr read endpoints
still absent from the contract (author per-screen); backend read gaps (HealthEvent/config-version
history) stay separately approval-gated.

**12O-2i (DONE)** — NOC's first mutating actions. Contract-first: authored the three POST endpoints
(`/v1/telecom/engines/{id}/health-check`→`EngineHealthReport`; `/{id}/sync` + `/{id}/sync/rollback`→
`SyncOutcome`) into `telvyn.v1.yaml`, regenerated types. New `<EngineActions>` on the engine detail
page: permission-gated buttons (Check-health=`telecom.health.read`; Sync/Rollback=`telecom.manage`),
**confirm dialog** before sync/rollback, **no auto-retry**, **honest results** (successful `SyncOutcome`
as `outcome — syncState`; expected `501` under Null connector shown neutrally; 409/5xx/400 as warnings);
each action refreshes engine + status. Server re-checks every call (gate is UX only). **ADR-0019
Accepted. web 107 → 115 tests, typecheck ✓, lint ✓, `next build` ✓.** **No backend/API/schema/DI change.**
Production stays on `NullEngineConnector` (sync/rollback → NOT_IMPLEMENTED). **12O-2j (DONE)** —
email-unverified banner. `<EmailVerificationBanner>` in the shell (below topbar) reads identity from
the already-contracted `GET /v1/auth/me` (new `getMe` action; `emailVerified` isn't on `/me/context`)
and resends via the existing `requestEmailVerification`; shows email + "Resend email" → "sent" when
unverified, renders nothing while loading/on-error/once-verified, session-dismissible. No contract
change. **web 115 → 120 tests, typecheck ✓, lint ✓, `next build` ✓. No backend/API/schema/DI change.**
**12O-2k (DONE)** — MFA enroll/manage. New `/account` (Account & security) page, reached from the user
menu, with no module permission (self-service for any authenticated member; the API still authorizes).
`<MfaSettings>` reads the authoritative `mfaEnabled` from `GET /v1/auth/me` and drives the
already-contracted TOTP lifecycle: enroll (new `enrollMfa` → otpauth URI, base32 key shown for manual
entry) → prove a 6-digit code to enable (new `enableMfa`) → one-time recovery codes → step-up disable
(new `disableMfa`) in a confirm dialog needing the current password AND a TOTP/recovery code. No QR
dependency; response types aliased from the generated `operations` (no contract change). **web 120 →
129 tests, typecheck ✓, lint ✓, `next build` ✓. No backend/API/schema/DI change.**
**12O-2l (DONE)** — type-to-confirm guard on engine sync/rollback (ADR-0019 addendum). The Sync and
Roll back confirm dialogs now require typing the exact engine name (case-sensitive, trimmed) before the
CTA enables — a mis-click guard for when a real connector is wired (both still return the honest
`501 NOT_IMPLEMENTED` under the Null connector today). `EngineActions` gained an `engineName` prop from
the detail view; Check-health stays direct; the typed value resets on open/close. UX only — the API
re-checks permission + platform. **web 129 → 131 tests, typecheck ✓, lint ✓, `next build` ✓. No
contract/backend/API/schema/DI change.**
**12O-2m (DONE)** — `cdr.read` permission (RBAC catalog). Added a dedicated `cdr.read` (resource `cdr`,
action `read`, billing group) so CDRs stop borrowing `wallet.read`. Granted to the billing-visible roles
— owner (via `*`), operator, auditor — so CDR visibility is unchanged (admin still has neither
`wallet.read` nor `cdr.read`). The seed is catalog-driven + idempotent: the key and role links land on
the next `prisma db seed` (no migration — permissions are seeded rows). Frontend: the CDRs nav/route
gate re-points from `wallet.read` to `cdr.read`. No contract change (`MeContext.permissions` is a
free-form `string[]`; no CDR route exists yet — Phase 14). **API unit 186 → 187 (catalog +1), web 131,
typecheck ✓, lint ✓, `next build` ✓.** API e2e NOT run here (test DB :5433 down; change is additive,
data-only, unit-covered — no controller/guard/route touched); owner re-seeds to apply.
**12O-2n (DONE)** — QR-code render for MFA enrollment. The setup step now shows a scannable QR of the
`otpauth://` URI above the manual setup key (relabelled the "can't scan?" fallback). New dependency
`qrcode.react@4.2.0` (pinned exact; zero transitive deps; React 19 peer; SVG output). QR drawn
dark-on-white with a quiet zone regardless of theme so it always scans, with an accessible `<title>`.
Frontend-only; no contract/backend change. **web 131 (enroll test asserts the QR gets the full otpauth
URI; manual key remains the fallback), typecheck ✓, lint ✓, `next build` ✓ (`/account` 5.2 → 11.3 kB).**
**12O-2o (DONE)** — carriers read screen (contract-first). First tenant-connectivity screen: read-only
`/carriers` list of the session's visible carriers (own + system), gated on `carrier.read` (not
platform). Contract-first (ADR-0002): authored `GET /v1/telecom/carriers` (cursor pagination +
`status`/`regionId`/`scope`/`q`) and `Carrier`/`CarrierCredentialRef`/`CarrierHealth`/`CarrierPage` into
`telvyn.v1.yaml` from the real backend view, regenerated `schema.ts`. Honest UNKNOWN health; secrets
never appear (credential reference only). `carriers-actions.ts` (`listCarriers`), `<CarriersView>`
(first page + Load more; loading/empty/error states), `/carriers` page, and a **Carriers** nav item
(phase 10). Only the list endpoint was contracted (per-screen as consumed); `…/{id}` + mutations stay
for later. **web 131 → 135, typecheck ✓, lint ✓, `next build` ✓. No backend/API change** (carrier API
already existed + documented).
**12O-2p (DONE)** — SIP trunks read screen (contract-first). Read-only `/sip-trunks` list of the
tenant's own trunks, gated on `sip_trunk.read` (tenant-scoped). Contract-first (ADR-0002): authored
`GET /v1/telecom/sip-trunks` (cursor pagination + `status`/`direction`/`transport`/`carrierId`/`q`) and
`SipTrunk`/`SipTrunkPage`/`SipTrunkCredentialRef`/`SipTrunkHealth`/`CarrierSummary` into `telvyn.v1.yaml`
from the real backend view, regenerated `schema.ts`. Control-plane only — honest UNKNOWN health;
secrets never appear (credential reference + carrier summary only). `sip-trunks-actions.ts`
(`listSipTrunks`), `<SipTrunksView>` (first page + Load more; loading/empty/error), `/sip-trunks` page,
and a **SIP trunks** nav item (phase 11). Only the list endpoint was contracted (per-screen as
consumed); `…/{id}` + mutations stay for later. **web 135 → 139, typecheck ✓, lint ✓, `next build` ✓.
No backend/API change** (SIP-trunk API already existed + documented).
**12O-2q (DONE)** — DIDs (Numbers) read screen (contract-first). The `/numbers` placeholder is replaced
by the real DID inventory — read-only list of the tenant's own numbers + lifecycle status, gated on
`did.read` (the Numbers nav item already existed; no nav change). Contract-first (ADR-0002): authored
`GET /v1/telecom/dids` (cursor pagination + `status`/`carrierId`/`sipTrunkId`/`routingProfileId`/
`regionId`/`country`/`q`) and `Did`/`DidPage`/`DidHealth` into `telvyn.v1.yaml` from the real backend
view, regenerated `schema.ts`. Control-plane only — honest UNKNOWN health; the DID API returns reference
ids only, so carrier/trunk render as short refs. `dids-actions.ts` (`listDids`), `<NumbersView>` (first
page + Load more; loading/empty/error), `/numbers` page swapped from `ModuleGate`. Only the list
endpoint was contracted (per-screen as consumed); `…/{id}` + mutations stay for later. **web 139 → 143,
typecheck ✓, lint ✓, `next build` ✓. No backend/API change** (DID API already existed + documented).
**12O-2r (DONE)** — routing profiles read screen (contract-first). Read-only `/routing` list of the
tenant's own routing profiles, gated on `routing.read` (tenant-scoped). Contract-first (ADR-0002):
authored `GET /v1/telecom/routing-profiles` (cursor pagination + `status`/`direction`/`strategy`/`q`) and
`RoutingProfile`/`RoutingPolicy`/`RoutingRule`/`RoutingProfilePage` into `telvyn.v1.yaml` from the real
backend view (list returns full policy + ordered rules), regenerated `schema.ts`. Declarative config
only — nothing executed. `routing-actions.ts` (`listRoutingProfiles`), `<RoutingView>` (per-profile
summary: direction/status/strategy/failover/rule-count/version; first page + Load more; loading/empty/
error), `/routing` page, and a **Routing** nav item (phase 12). Full rules → detail drawer (deferred).
Only the list endpoint was contracted (per-screen as consumed); `…/{id}` + mutations stay for later.
**web 143 → 147, typecheck ✓, lint ✓, `next build` ✓. No backend change** (routing API already existed;
API.md gained the `strategy` filter it had omitted).
**12O-2s (DONE)** — LCR policies read screen (contract-first). Read-only `/lcr` list of the tenant's own
least-cost-routing policies, gated on `routing.read` (LCR is part of the routing domain). Contract-first
(ADR-0002): authored `GET /v1/telecom/lcr-policies` (cursor pagination + `enabled`/`strategy`/`q`) and
`LcrPolicy`/`LcrRoute`/`LcrPolicyPage` into `telvyn.v1.yaml` from the real backend view (list returns
route candidates in deterministic selection order; `costMicros` JSON-safe integer), regenerated
`schema.ts`. Declarative selection only — nothing executed/rated/billed. `lcr-actions.ts`
(`listLcrPolicies`), `<LcrView>` (per-policy summary: strategy/enabled/candidate-count/version; first
page + Load more; loading/empty/error), `/lcr` page, and an **LCR** nav item (phase 12). Ordered
candidates → detail drawer (deferred). Only the list endpoint was contracted (per-screen as consumed);
`…/{id}` + mutations stay for later. **web 147 → 151, typecheck ✓, lint ✓, `next build` ✓. No
backend/API change** (LCR API already existed + documented). **This completes the telecom read-screen
set: carriers, SIP trunks, numbers (DIDs), routing, LCR.**
**12O-2t (DONE)** — carrier detail drawer (contract-first). First read-screen detail view: a "View"
action per carriers row opens a drawer with the full carrier fetched fresh by id. Contract-first
(ADR-0002): authored `GET /v1/telecom/carriers/{id}` (reusing the existing `Carrier` schema; 404 for
foreign/removed, IDOR-safe), regenerated `schema.ts`. `getCarrier(id)` action; `<CarrierDetailDrawer>`
(keyed by id → refetch per open; loading/error/404) shows scope/type/country/status/health/priority/
codecs/caps/credential-ref/timestamps. Read-only; `carrier.read` re-checked server-side. **web 151 →
152, typecheck ✓, lint ✓, `next build` ✓. No backend/API change** (endpoint already existed +
documented). Sets the detail-view pattern for trunks/DIDs/routing/LCR.

**12O-2u (DONE)** — SIP trunk detail drawer (contract-first). Applies the 2t pattern to SIP trunks: a
"View" action per `/sip-trunks` row opens a drawer with the full trunk fetched fresh by id. Contract-first
(ADR-0002): authored `GET /v1/telecom/sip-trunks/{id}` (reusing the existing `SipTrunk` schema; 404 for
foreign/removed, IDOR-safe), regenerated `schema.ts` (additive). `getSipTrunk(id)` action;
`<SipTrunkDetailDrawer>` (keyed by id → refetch per open; loading/error/404) shows carrier summary/
direction/endpoint/port/transport+TLS/auth-mode/allowed-IPs/codecs/SRTP/DTMF/caps/status/health (honest
UNKNOWN)/credential-ref/timestamps. Read-only; `sip_trunk.read` re-checked server-side; secrets never
rendered. **web 152 → 153 (full suite ✓), `next build` ✓. No backend/API change** (endpoint already
existed + documented in `API.md`).

**12O-2v (DONE)** — DID (number) detail drawer (contract-first). Applies the 2t/2u pattern to the Numbers
inventory: a "View" action per `/numbers` row opens a drawer with the full DID fetched fresh by id.
Contract-first (ADR-0002): authored `GET /v1/telecom/dids/{id}` (reusing the existing `Did` schema; 404
for foreign/pool/removed, IDOR-safe), regenerated `schema.ts` (additive). `getDid(id)` action;
`<NumberDetailDrawer>` (keyed by id → refetch per open; loading/error/404) shows country/status/health
(honest UNKNOWN)/carrier/trunk/routing-profile/region as full reference ids (the DID API returns ids only,
never embedded objects)/assigned/timestamps. Read-only; `did.read` re-checked server-side. **web 153 →
154 (full suite ✓), `next build` ✓ (clean retry after the known transient `next/font` fetch failure). No
backend/API change** (endpoint already existed + documented in `API.md`).

**12O-2w (DONE)** — routing profile detail drawer (contract-first). Applies the pattern to Routing and
surfaces what the 2r list summarized: a "View" action per `/routing` row opens a drawer with the full
profile — complete selection/failover **policy** + **ordered rule set** (priority ASC) — fetched fresh by
id. Contract-first (ADR-0002): authored `GET /v1/telecom/routing-profiles/{id}` (reusing the existing
`RoutingProfile` schema; 404 foreign/removed, IDOR-safe), regenerated `schema.ts` (additive), added
`RoutingRule`/`RoutingPolicy` aliases to `contracts/index.ts`. `getRoutingProfile(id)` action;
`<RoutingDetailDrawer>` (keyed by id → refetch per open; loading/error/404) shows direction/status/
description/strategy/failover+conditions/attempt+timeout caps/version/timestamps and each rule (priority/
destination type+value/enabled/optional weight+timeout+failover) in priority order. Declarative config
only — nothing executed. Read-only; `routing.read` re-checked server-side. **web 154 → 155 (full suite ✓),
`next build` ✓ (fixed a missing `RoutingRule` export via the index alias, then clean). No backend/API
change** (endpoint already existed + documented in `API.md`).

**12O-2x (DONE)** — LCR policy detail drawer (contract-first). Completes the read-screen detail-drawer set
(carriers, SIP trunks, DIDs, routing, LCR). A "View" action per `/lcr` row opens a drawer with the full
policy + its route candidates in the server's deterministic selection order (NOT re-sorted —
strategy-dependent), fetched fresh by id. Contract-first (ADR-0002): authored `GET
/v1/telecom/lcr-policies/{id}` (reusing the existing `LcrPolicy` schema; 404 foreign/removed, IDOR-safe),
regenerated `schema.ts` (additive), added the `LcrRoute` alias to `contracts/index.ts`. `getLcrPolicy(id)`
action; `<LcrDetailDrawer>` (keyed by id → refetch per open; loading/error/404) shows strategy/state/
description/version/timestamps and each candidate (priority/prefix+country/cost-from-micros+currency/
enabled/optional weight+effective-window). Declarative selection only — nothing executed, rated or billed.
Read-only; `routing.read` re-checked server-side. **web 155 → 156 (full suite ✓), `next build` ✓. No
backend/API change** (endpoint already existed + documented in `API.md`).
**12O-2y (DONE)** — list filters: shared primitive + carriers screen (contract-first). First filter
sub-phase. New reusable `useDebouncedValue` hook + `<ListFilters>` primitive (debounce-ready search +
accessible native `<select>`s + Clear, `role="search"`), wired into the Carriers screen: search (`q`,
300 ms debounce), status, scope → the list endpoint's already-contracted params. **No contract/schema
change** (pure UI→existing-param wiring). Filter changes reset pagination + refetch (memoized params;
Load-more carries filters); a filter returning nothing shows an honest "No carriers match your filters."
state (distinct from "none configured") with Clear. `regionId` omitted (no region picker yet). Read-only;
server authoritative + auto-scoped. **web 156 → 165 (full suite ✓, 33 files): +3 hook / +3 primitive / +3
carriers. `next build` ✓.** Sets the filter pattern for the other read screens.
**12O-2z (DONE)** — list filters: SIP trunks screen. Applies the 2y pattern (`<ListFilters>` +
`useDebouncedValue`) to the SIP trunks read screen: search (`q`, 300 ms debounce), status, direction,
transport → the list endpoint's already-contracted params. **No contract/schema change** (pure
UI→existing-param wiring; verified `sip-trunks.service.ts` genuinely applies all four `where` filters, so
none is a dishonest no-op). Filter changes reset pagination + refetch; a filter returning nothing shows an
honest "No SIP trunks match your filters." state with Clear. `carrierId` omitted (no carrier picker yet).
Read-only; server authoritative + tenant-auto-scoped. **web 165 → 169 (full suite ✓, 33 files): +4
(status / direction / debounced search / no-matches + Clear). `next build` ✓ (/sip-trunks 5.79 kB).** No
new reusable code — reuses the 2y primitive.
**12O-2aa (DONE)** — list filters: numbers (DIDs) screen. Applies the 2y pattern (`<ListFilters>` +
`useDebouncedValue`) to the Numbers read screen: search (`q`, 300 ms debounce — substring on canonical
E.164) + status (7-value DID lifecycle enum) → the list endpoint's already-contracted params. **No
contract/schema change** (pure UI→existing-param wiring; verified `dids.service.ts` genuinely applies both
`where.status` + `where.e164 contains`, so neither is a dishonest no-op). Filter changes reset pagination +
refetch; a filter returning nothing shows an honest "No numbers match your filters." state with Clear. The
id-based filters + `country` are omitted (no pickers; `country` has no canonical option source and a
400-prone 2-char DTO — `q` covers it). Read-only; server authoritative + tenant-auto-scoped. **web 169 →
172 (full suite ✓, 33 files): +3 (status / debounced search / no-matches + Clear). `next build` ✓
(/numbers 5.36 kB).** No new reusable code — reuses the 2y primitive.
**12O-2ab (DONE)** — list filters: routing profiles screen. Applies the 2y pattern (`<ListFilters>` +
`useDebouncedValue`) to the Routing read screen: search (`q`, 300 ms debounce — case-insensitive name) +
status + direction (inbound/outbound) + strategy (priority/weighted/round-robin/simultaneous) → the list
endpoint's already-contracted params. **No contract/schema change** (pure UI→existing-param wiring;
verified `routing.service.ts` genuinely applies all four `where.status`/`direction`/`selectionStrategy` +
`name contains`, so none is a dishonest no-op). Filter changes reset pagination + refetch; a filter
returning nothing shows an honest "No routing profiles match your filters." state with Clear. Declarative
config only — nothing executed. Read-only; server authoritative + tenant-auto-scoped. **web 172 → 176
(full suite ✓, 33 files): +4 (status / strategy / debounced search / no-matches + Clear). `next build` ✓
(/routing 5.74 kB).** No new reusable code — reuses the 2y primitive.
**12O-2ac (DONE)** — list filters: LCR policies screen (+ backend `enabled`-filter bug fix). **Completes
the read-screen filter set** (carriers / SIP trunks / numbers / routing / LCR). Applies the 2y pattern
(`<ListFilters>` + `useDebouncedValue`) to the LCR read screen: search (`q`, 300 ms debounce — name) +
strategy (lowest-cost/highest-priority/weighted/quality-first) + tri-state state (enabled/disabled) → the
list endpoint's already-contracted params. **No contract change.** **Backend bug fix** (the one deviation
from frontend-only): list-query `enabled` was `z.coerce.boolean()` (`Boolean("false")===true`), silently
inverting `enabled=false`; replaced with an explicit string→boolean parse in `lcr.dto.ts` + new
`lcr.dto.test.ts` (5 tests) proving both directions. Verified `lcr.service.ts` applies
`where.enabled`/`selectionStrategy` + `name contains`. UI maps state→real boolean. Filter changes reset
pagination + refetch; honest "No LCR policies match your filters." empty state. Declarative selection only;
`costMicros` stays integer. Read-only; server authoritative + tenant-auto-scoped. **web 176 → 180 (full
suite ✓, 33 files): +4. API unit 187 → 192 (20 files): +5 (DTO coercion). `next build` ✓ (/lcr 5.48 kB);
API tsc/eslint ✓.** No `API.md` change (contract already declared `enabled: boolean`; impl now honours it).
**12O-2ad (DONE)** — Admin / Members read screen (contract-first). Replaces the `/admin` ModuleGate
placeholder with a real read-only members list — the last NOC/admin read surface. The endpoint already
existed (`GET /v1/members`, `member.read`, `authz.controller.ts` → `tenancy.listMembers()`); this phase
**authored it into the contract** (new `Member` schema + path, regenerated `schema.ts` additively, `Member`
alias) and built the screen. The endpoint returns a plain **array** (small team — no pagination/query
params), so `<MembersView>` loads via `useResource` (no Load-more). Columns: name / email / membership
status (ACTIVE·SUSPENDED) / account status (ACTIVE·INVITED·DISABLED) / role-name badges; honest
loading/empty/error; no secrets. Route already gated: nav `member.read` + `RouteGuard` (not platform-only).
Read-only — member management (invite / role changes) is a later phase. **web 180 → 183 (full suite ✓, 34
files): +3. `next build` ✓ (/admin now a real 3.73 kB route). No backend change** (endpoint +
tenant-scoping already existed + e2e-covered). `API.md` updated.
**12O-2ae (DONE)** — carrier create / edit / delete (FIRST WRITE SLICE, contract-first). The carrier
POST/PATCH/DELETE endpoints already existed (`carrier.create`/`update`/`delete`, scope server-derived,
audited with a credential reference only); this phase **authored them into the contract** (`CreateCarrier`
/ `UpdateCarrier` / `InlineCredentialInput` + POST/PATCH/DELETE paths), regenerated `schema.ts` (additive),
added aliases + `createCarrier`/`updateCarrier`/`deleteCarrier`. New `<CarrierForm>` modal (create+edit:
name/type/status/country/priority/maxCps/maxConcurrent/codecs with client validation); detail drawer got
Edit/Delete (gated `carrier.update`/`delete`); carriers-view got a New-carrier button (gated
`carrier.create`) + soft-delete confirm; mutations reload the list. **Deferred (optional, still on the
API):** `regionId` (no picker) + credential attachment (secret handling). UX-only gating; server
re-validates + re-checks every call. **web 183 → 186 (full suite ✓, 34 files): +3. `next build` ✓
(/carriers 5.69 kB); eslint ✓. No backend change** (endpoints + audit + tenant-scoping pre-existed,
e2e-covered). `API.md` updated. Sets the write pattern for the other resources.
**12O-2af (DONE)** — SIP trunk create / edit / delete (SECOND WRITE SLICE, contract-first). Rolls the 2ae
pattern to SIP trunks. The trunk POST/PATCH/DELETE endpoints already existed (`sip_trunk.create`/`update`/
`delete`; ownership server-derived, `carrierId` scope-validated, endpoint values SSRF-validated, audited
with a credential reference only); this phase **authored them into the contract** (`CreateSipTrunk` /
`UpdateSipTrunk` / `InlineSipCredentialInput` + POST/PATCH/DELETE paths), regenerated `schema.ts` (additive),
added aliases + `createSipTrunk`/`updateSipTrunk`/`deleteSipTrunk`. New `<SipTrunkForm>` modal (create+edit:
name, **required carrier picker** via `listCarriers` first page — seeded with the current carrier in edit,
direction, host, SIP URI, port, transport, TLS/SRTP, auth mode, allowed-IPs textarea, maxCps/maxConcurrent,
DTMF, codecs; client range validation). Detail drawer got Edit/Delete (gated `sip_trunk.update`/`delete`);
sip-trunks-view got a New-trunk button (gated `sip_trunk.create`) + soft-delete confirm; mutations reload
the list. **Deferred (optional, still on the API):** credential attachment (secret handling); `authMode`
still settable. UX-only gating; server re-validates + re-checks every call + stays tenant/scope-authoritative.
**web 186 → 189 (full suite ✓, 34 files): +3. `next build` ✓ (/sip-trunks 7.08 kB); eslint ✓. No backend
change** (endpoints + audit + tenant-scoping + SSRF validation pre-existed, e2e-covered). `API.md` updated.
**12O-2ag (DONE)** — DID (Numbers) create / edit / delete (THIRD WRITE SLICE, contract-first). Rolls the
pattern to Numbers. DID POST/PATCH/DELETE already existed (all gated by the single `did.manage`; ownership
server-derived, `number` normalized to E.164 + `country` derived server-side, relationship refs scope/existence
validated with a carrier↔trunk consistency rule, dup number → 409, audited with reference ids only). Authored
into contract: `CreateDid` / `UpdateDid` schemas + POST/PATCH/DELETE paths; regenerated `schema.ts` (additive);
`CreateDid` / `UpdateDid` aliases + `createDid`/`updateDid`/`deleteDid`. New `<NumberForm>` modal (create: raw
number + status + carrier/trunk/routing **pickers** — each first-page + seeded-by-id since the DID API returns
ids only; edit: number read-only/immutable, status + three refs, clearing a picker sends null to detach).
Detail drawer got Edit/Delete (gated `did.manage`); numbers-view got a New-number button (gated `did.manage`) +
soft-delete confirm; mutations reload. **Deferred (optional, still on API):** `regionId` picker. **Constitution
gap surfaced (pre-existing, not introduced here):** the 12G service does NOT enforce status-*transition* rules —
`status` is a free field, so the UI is a plain select, not a guarded state machine (flagged for a future backend
slice). UX-only gating; server re-checks + re-normalizes + re-validates relationships every call. **web 189 →
192 (full suite ✓, 34 files): +3. `next build` ✓ (/numbers 5.61 kB); eslint ✓. No backend change** (endpoints +
audit + tenant-scoping + E.164 normalization + relationship validation pre-existed, e2e-covered). `API.md`
updated.
**12O-2ah (DONE)** — routing profile create / edit / delete, PROFILE + POLICY ONLY (FOURTH WRITE SLICE,
contract-first; owner chose the bounded scope). Manages the profile envelope (name/direction/description/status)
+ selection/failover policy; the ordered RULES EDITOR is a dedicated later slice (12O-2ai). POST/PATCH/DELETE
pre-existed (12H/12I, single `routing.manage` perm; declarative config only — nothing executed; dup name → 409;
atomic optimistic concurrency via `expectedVersion`; destinations SSRF/E.164/owned-trunk validated). Authored
into contract: `CreateRoutingProfile`/`UpdateRoutingProfile` + `RoutingRuleInput`/`RoutingScheduleInput` (full
`rules[]` described even though this UI omits it); regenerated schema.ts (additive); aliases +
`createRoutingProfile`/`updateRoutingProfile`/`deleteRoutingProfile`. New `<RoutingForm>` (profile fields +
Policy fieldset; client range validation + "failover ⇒ ≥1 condition"). **CRITICAL safety: rules never sent —
create omits → empty set; edit omits → backend PRESERVES existing rules (only replaces when `rules` present), so
a policy edit can't wipe rules.** Edit sends `expectedVersion` → concurrent change = 409. Detail drawer got
Edit/Delete (gated `routing.manage`); routing-view got New-profile button (gated `routing.manage`) +
soft-delete confirm (notes rules go with it); mutations reload. UX-only gating; server re-checks + re-validates
every call. **web 192 → 195 (full suite ✓, 34 files): +3. `next build` ✓ (/routing 6.25 kB; one `next/font`
fetch-flake retry); eslint ✓. No backend change** (endpoints + audit + tenant-scoping + optimistic concurrency +
destination validation pre-existed, e2e-covered). `API.md` updated.
**12O-2ai (DONE)** — routing RULES EDITOR (FRONTEND ONLY — no contract/backend change; completes the routing
write surface 2ah deferred). New `<RoutingRulesEditor>` opened by an "Edit rules" drawer footer action (gated
`routing.manage`); loads the full rule set, PATCHes the COMPLETE `rules` array via existing
`updateRoutingProfile` + `expectedVersion` (409 on concurrent change). **Replace-semantics safety: advanced
per-rule options NOT exposed here (carrier tag, typed failover, schedule) are PRESERVED verbatim on existing
rules ("+ advanced preserved" chip) so editing can't drop them.** Editable: destination type+value (per-type
hint), priority/order, enabled, weight, timeout, retries; add/remove; client range validation; server validates
destinations per type (authoritative). Empty set removes all rules. Contract already had RoutingRuleInput/
RoutingScheduleInput (from 2ah) → pure UI. **web 195 → 198 (full suite ✓, 34 files): +3. `next build` ✓
(/routing 8.03 kB); eslint ✓. No backend/contract change.** `API.md` updated. **Routing write surface COMPLETE
(profile + policy + rules).**
**12O-2aj (DONE)** — LCR policy create / edit / delete, POLICY ONLY (FIFTH WRITE SLICE, contract-first;
owner-chosen bounded scope mirroring routing 2ah). Manages the policy envelope (name/description/selectionStrategy/
enabled); the ROUTES EDITOR — carrying integer `costMicros` money-handling (owner chose RAW-MICROS entry) — is a
later slice (12O-2ak). POST/PATCH/DELETE pre-existed (12J, single `routing.manage` perm — LCR reuses routing's
perms; declarative route SELECTION only, nothing executed/rated/billed; costMicros integer/BigInt; dup name →
409; atomic optimistic concurrency via `expectedVersion`; carrier-accessible + trunk-owned validated). Authored
into contract: `CreateLcrPolicy`/`UpdateLcrPolicy` + `LcrRouteInput` (full routes[] described w/ costMicros
integer even though this UI omits it); regenerated schema.ts (additive); aliases +
`createLcrPolicy`/`updateLcrPolicy`/`deleteLcrPolicy`. New `<LcrForm>` (name/description/strategy/enabled).
**CRITICAL safety: routes never sent — create omits → empty set; edit omits → backend PRESERVES existing routes
(and their money values), only replaces when `routes` present.** Edit sends `expectedVersion` → concurrent
change = 409. Detail drawer got Edit/Delete (gated `routing.manage`); lcr-view got New-policy button (gated
`routing.manage`) + soft-delete confirm (notes routes go with it); mutations reload. UX-only gating; server
re-checks + re-validates every call. **web 198 → 202 (full suite ✓, 34 files): +4. `next build` ✓ (/lcr 5.09 kB);
eslint ✓. No backend change** (endpoints + audit + tenant-scoping + optimistic concurrency + costMicros integer
handling + carrier/trunk validation pre-existed, e2e-covered). `API.md` updated.
**12O-2ak (DONE)** — LCR ROUTES EDITOR (FRONTEND ONLY — no contract/backend change; completes the LCR write
surface 2aj deferred). New `<LcrRoutesEditor>` opened by an "Edit routes" drawer footer action (gated
`routing.manage`); loads the full route set, PATCHes the COMPLETE `routes` array via existing `updateLcrPolicy`
+ `expectedVersion` (409 on concurrent change). **MONEY (owner-chosen): `costMicros` entered as RAW non-negative
INTEGER micros — NO float (string→int whole-number parse).** **Replace-semantics safety: non-exposed per-route
fields (sipTrunkId, effectiveFrom/To) PRESERVED verbatim on existing routes ("+ advanced preserved" chip) so
editing can't drop them.** Editable: carrier (required — picker from listCarriers first page, seeded-by-id since
LCR API returns ids only), prefix (required `^\+?[0-9]{1,15}$`), cost (required int micros), currency (required
select USD/EUR/GBP/INR/AUD/CAD/JPY), priority, weight, country (ISO-2), enabled; add/remove; server validates
carrier-accessible + trunk-owned (authoritative). Empty set removes all routes. Contract already had
LcrRouteInput (from 2aj) → pure UI. **web 202 → 205 (full suite ✓, 34 files): +3. `next build` ✓ (/lcr 7.45 kB);
eslint ✓. No backend/contract change.** `API.md` updated. **LCR write surface COMPLETE (policy + routes).**
**12O-2al (DONE)** — member management write = ROLE ASSIGNMENT (contract-first; frontend only). **Honest scope:
the ONLY member mutation the backend exposes is `PUT /v1/members/:id/roles` (`member.manage`) — NO invite /
suspend / remove endpoint, so the UI offers only role assignment.** Endpoint pre-existed (12B authz surface,
`authz.controller.ts`; scoped membership → 404 foreign, validates roleIds valid-for-tenant → 409, atomic
replace, returns full member list). Authored into contract: `PUT /v1/members/{id}/roles` w/ `SetMemberRoles`
`{roleIds uuid[] max20}` → `Member[]`, + `GET /v1/roles` (`role.read`) → `Role[]` {id,key,name,description,
isSystem,permissions[]}. Regenerated schema.ts (additive); aliases `TenantRole` (new contract `Role`; the
existing `Role` alias is MeContext's own role shape) + `SetMemberRoles`. New `listRoles`/`setMemberRoles` actions
(put). New `<MemberRolesDialog>` (loads assignable roles, pre-checks current, Save sends COMPLETE set = replace
semantics; empty-set warning; server authoritative). `<MembersView>` got a `member.manage`-gated "Manage roles"
action per row + reloads from authoritative refetch on save. **web 205 → 207 (full suite ✓, 34 files): +2.
`next build` ✓ (/admin 2.7 kB); eslint ✓. No backend change** (endpoints + audit + tenant-scoping + role
validation pre-existed, e2e-covered). `API.md` updated. **NOC/ADMIN WRITE SURFACE COMPLETE** (carriers · SIP
trunks · numbers · routing profile+policy+rules · LCR policy+routes · member roles).
**12O-2am (DONE)** — carrier INLINE CREDENTIAL (FRONTEND ONLY — no contract/backend change; fills the credential
half 2ae deferred). `<CarrierForm>` got an optional Credential fieldset creating+attaching inline `credential`
{type(SIP_PASSWORD/CARRIER_API/ENGINE_API), label, hint?, secret}. **SECRET write-only (type=password,
autoComplete=off, never pre-filled) → straight to vault; carrier returns only non-secret ref.** All-or-nothing
when engaged (type+label+secret required); NOT engaged → body omits `credential` → edit leaves it unchanged.
Edit shows current cred as ref + "Replace credential" toggle; create "Attach a credential". **NOT offered:
attach-existing-by-credentialId (NO credentials-list endpoint → picker would be dishonest; field stays on API),
detach (API has no null), regionId (no picker).** Contract already had InlineCredentialInput + credential (2ae);
`createCarrier`/`updateCarrier` already carry it → pure UI, no new action. Cred field labels "Credential type"/
"Credential label" to avoid collision w/ carrier Type. +3 tests (create-with-inline-cred asserting exact
{type,label,secret} + Secret input type=password / secret-required-once-engaged blocks submit / edit-without-
touching-cred omits credential+credentialId) → web **210** (34 files); isolated `next build` REAL_EXIT=0 FIRST
try (/carriers 5.69→6.7 kB); eslint 0. 2 files (form+test) +~200, NO apps/api, NO contracts.
**12O-2an (DONE)** — SIP trunk INLINE CREDENTIAL (FRONTEND ONLY — no contract/backend change; fills the
credential half 2af deferred; same pattern as carrier 2am). `<SipTrunkForm>` got an optional Credential
fieldset — but the SIP inline cred has **NO `type` field** (forced SIP_PASSWORD server-side) so only label +
hint? + secret. **SECRET write-only (type=password, autoComplete=off, never pre-filled) → vault; trunk returns
only non-secret ref {label,type}.** All-or-nothing when engaged (label+secret required); NOT engaged → omits
`credential` → edit leaves unchanged. Edit shows current cred ref + "Replace credential"; create "Attach a
credential". NOT offered: attach-existing-by-credentialId (no list endpoint), detach (no null). Contract already
had InlineSipCredentialInput + credential (2af); createSipTrunk/updateSipTrunk carry it → pure UI. +3 tests
(create-with-inline-cred asserts {label,secret} + NO type key + Secret type=password / secret-required blocks /
edit-without-touching omits credential+credentialId) → web **213** (34 files); isolated `next build` REAL_EXIT=0
FIRST try (/sip-trunks 7.08→7.88 kB); eslint 0. 2 files (form+test), NO apps/api, NO contracts.
**12O-2ao (DONE)** — DID REGION picker (FRONTEND ONLY — no contract/backend change; fills the regionId 2ag
deferred). 4th relationship picker ("Region") on `<NumberForm>` via same useOptions pattern, loaded from
`listRegions` (plain array `GET /v1/telecom/regions`), labelled `name (code)`, edit seeded by DID's current
region id (shown by id until list loads). Create sends selected region; edit sends regionId id-or-null (clear =
detach, matches other refs). regionId authored into CreateDid/UpdateDid in 2ag → pure UI, no contract/action.
+2 tests (create-with-region asserts regionId in body / edit-clears-region sends regionId:null) → web **215**
(34 files); isolated `next build` REAL_EXIT=0 FIRST try (/numbers 5.61→6.21 kB); eslint 0. 2 files (form+test),
NO apps/api, NO contracts.
**12O-2ap (DONE)** — routing-rule FAILOVER + SCHEDULE editing (FRONTEND ONLY — no contract/backend change; makes
the 2ai preserved-but-read-only fields editable). `<RoutingRulesEditor>` per rule card: Failover sub-section
(type select "— none" + destination [disabled until type] + after-seconds 1-600) + Schedule sub-section behind
"Restrict to a schedule" checkbox (timezone text, 7 day checkboxes Sun-Sat, 2 `<input type=time>` From/To).
Times `HH:MM`↔minutes-of-day via integer math (hhmmToMinutes/minutesToHHMM, NO float); existing rules hydrated
from stored minutes. Validation: failover dest+type together (both/neither), after 1-600; schedule all-or-nothing
(tz req, ≥1 day, start<end). Replace-semantics save + expectedVersion unchanged; server validates dest-per-type +
IANA tz + rejects self-failover. **ONLY field still not editable: per-rule `carrierId` tag (no picker yet) —
carried through verbatim, "+ carrier preserved" chip.** RoutingRuleInput/RoutingScheduleInput authored 2ah → pure
UI. GOTCHA: failover labels "Failover type"/"Failover destination" (distinct from rule's own Destination fields).
+2 tests (add-failover+schedule asserts exact failover* + schedule{tz,daysOfWeek:[1],startMinute:540,endMinute:1020}
/ failover-type-without-dest blocks; existing round-trip test still green) → web **217** (34 files); isolated
`next build` REAL_EXIT=0 FIRST try (/routing 8.03→9.2 kB); eslint 0. 2 files (editor+test), NO apps/api, NO contracts.
**12O-2aq (DONE)** — LCR per-route SIP TRUNK + EFFECTIVE-DATE editing (FRONTEND ONLY — no contract/backend
change; makes the 2ak preserved fields editable). `<lcr-routes-editor.tsx>` per route: 2nd picker SIP trunk
(loaded once from `listSipTrunks`, seeded by route trunk ids, "— none" option — same pattern as carrier picker)
+ 2 `<input type=datetime-local>` effectiveFrom/To. **Times local-tz↔ISO instants: `localInputToIso` = new
Date(local).toISOString(), `isoToLocalInput` hydrates back (minute precision, NO float).** Validation: both
effective sides optional, both-set → from<to (server enforces too). **"+ advanced preserved" chip REMOVED —
every per-route field now editable, nothing carried-through-unseen.** Replace-semantics + expectedVersion +
costMicros raw-int unchanged. LcrRouteInput already had sipTrunkId/effectiveFrom/To (2aj) → pure UI. GOTCHA
avoided: test mocks `sip-trunks-actions.listSipTrunks` (editor now loads it). +1 test (edit-route-set-trunk+window
asserts sipTrunkId + local→ISO via tz-robust `new Date(local).toISOString()`; round-trip test still green) → web
**218** (34 files); isolated `next build` REAL_EXIT=0 FIRST try (/lcr 7.45→8.16 kB); eslint 0. 2 files
(editor+test), NO apps/api, NO contracts.
**12O-2ar (DONE)** — friendlier LCR DECIMAL COST entry (FRONTEND ONLY — no contract/backend; LAST deferred
slice). Cost field raw-integer-micros → decimal "Cost / min" (currency units, e.g. 0.012). **EXACT string math,
NO float: `decimalToMicros` = Number(whole)*1_000_000 + Number(fracPaddedTo6) [regex `^(\d+)(?:\.(\d{1,6}))?$`,
>6 dp or non-decimal → INVALID_COST error]; `microsToDecimal` inverse via string slicing (padStart 7, split last
6, trim trailing zeros) → existing micros shown back as decimal, round-trips exactly e.g. 1500⇄"0.0015".** Live
hint "= N micros" keeps the stored integer visible. Stored/validated value unchanged (integer costMicros,
bounded ≤1e12). EditRoute `costMicros:string` → `cost:string`. Pure UI. +2 tests (>6-dp rejected+not-saved /
hydrate-as-decimal+round-trip-exact; 2 prior cost tests updated to decimals asserting exact micros 0.012→12000,
0.05→50000) → web **220** (34 files); isolated `next build` REAL_EXIT=0 (one next/font retry) (/lcr 8.16→8.37
kB); eslint 0. 2 files (editor+test), NO apps/api, NO contracts.
**🎉 ALL Phase 12O deferred FRONTEND enhancement slices COMPLETE — NOC/admin write surface + all polish done.**
**12O-2as (DONE)** — engine HEALTH-EVENT HISTORY (read; **FIRST BACKEND slice this run**, owner-approved as the
backend read-gap feature). `GET /v1/telecom/engines/:id/health-events` (platform + `telecom.health.read`,
cursor-paginated newest-first). **NO schema change** — HealthEvent model existed; added `EngineHealthService.history`
(shared cursorArgs/toPage over uuidv7 id) + controller endpoint (engines.get→404 then health.history) + contract
`HealthEvent`/`HealthEventPage`. **Safe view: {id, fromStatus(null-first), toStatus, reason, correlationId,
createdAt} — never entityType/entityId/tenantId.** Frontend: `listEngineHealthEvents` action + self-contained
`<EngineHealthHistory>` "Health history" timeline on engine detail (/infrastructure/[id]), own load/error/Load-more,
from→to+reason+time. +3 API unit (192→195, engine-health.service.test — scoped query + safe-view-no-leak + nextCursor
+ cursor-passthrough) + 4 web (220→224, engine-health-history.test). API tsc✓ eslint✓ unit 195✓ (21 files); web
build✓ (/infrastructure/[id] 3.23→4.36 kB) eslint✓ suite 224✓. e2e (platform gating/404/ordering) CI-only. 11 files
(2 api + 1 api-test + contract/schema + 4 web + ...). Docs updated.
**12O-2at (DONE)** — engine CONFIG-VERSION HISTORY (read; SECOND BACKEND read-gap slice, mirrors 2as). `GET
/v1/telecom/engines/:id/config-versions` (platform + `telecom.health.read`, consistent w/ status version posture,
cursor-paginated newest-first). **NO schema change** — TelecomConfigVersion existed (written by
`EngineSyncService.record` on sync/rollback; entityType="engine"; newConfig=VersionSnapshot{kind,fingerprint,
short,summary}, previousConfig={fingerprint}). Added READ: `EngineSyncService.history` (shared cursorArgs/toPage
uuidv7 id) + controller endpoint (engines.get→404 then syncSvc.history). Contract: `ConfigVersion`/`ConfigVersionPage`.
**SAFE PROJECTION: {id, changeType(CREATE/UPDATE/DELETE/STATUS_CHANGE), kind(desired/applied/reconcile_pending|null),
version(=snapshot.short), previousVersion(=shortFingerprint(prev.fingerprint)|null), summary(counts|null), actorId,
correlationId, createdAt} — only fingerprint+counts, NEVER raw config body or entityType/entityId/tenantId.**
Frontend: `listEngineConfigVersions` + `<EngineConfigHistory>` timeline on engine detail below health history
(change/kind badges, prev→version short fps, summary counts). +3 API unit (195→198, engine-sync.history.test) + 4
web (224→228, engine-config-history.test). API tsc✓ eslint✓ unit 198✓ (22 files); web build✓ (/infrastructure/[id]
4.36→4.71 kB) eslint✓ suite 228✓ (34 files). e2e CI-only. 12 files + 3 new, NO prisma change. (46th commit; feature
tip now <2at>; integration branch @5fcd64e now 27 behind.) **Engine detail now carries BOTH read-gap histories
(health + config-version).**
**12O-2au (DONE)** — node HEALTH PROBE (health-framework foundation; owner chose operator-probe over heartbeat).
**Discovery first: "node/carrier health history" CANNOT be built honestly — NOTHING writes NODE/CARRIER HealthEvent
rows (engine health service is the only writer; node health = unpopulated 1:1 snapshot, not a log). Surfaced it;
owner chose to build the framework, operator-probe model (nodes have NO auth surface → heartbeat-ingest would need
new node-identity/auth = ADR-worthy, deferred).** `POST /v1/telecom/nodes/:id/health-check` (platform +
`telecom.health.read`), mirrors engine probe. New `NodeHealthService.probe` — **honest posture, NEVER fabricated
HEALTHY (no node liveness connector): DISABLED(admin)/UNCONFIGURED(no hostRef)/UNVERIFIED→UNKNOWN** — updates NodeHealth
snapshot (latencyMs null, lastHeartbeatAt untouched — probe≠heartbeat), records NODE HealthEvent on transition (so NODE
events now get produced → future NODE history read non-empty). **NO schema change** (reuses NodeHealth + HealthEvent
which already supports NODE). Wired NodeHealthService into telecom.module; endpoint audits telecom.node.health_checked.
Contract: path + `NodeHealthReport` {nodeId,status,reachability(UNCONFIGURED/DISABLED/UNVERIFIED),detail,correlationId,
checkedAt}. Frontend: `checkNodeHealth` + `telecom.health.read`-gated per-row "Check" button on `<NodesView>` (probes+
reloads; NodesView now wraps useSession → test needs SessionProvider). +5 API unit (198→203, node-health.service.test:
posture mapping + first-transition + no-event-unchanged + 404; stub prisma w/ $transaction) + 2 web (228→230,
nodes-view.test). API tsc✓ eslint✓ unit 203✓ (23 files); web build✓ (/infrastructure/nodes 5.36 kB) eslint✓ suite 230✓
(36 files). e2e CI-only. 7 files + 2 new (service + its test), NO prisma. (47th commit; feature tip now <2au>;
integration branch @5fcd64e now 28 behind.) **Node health now REAL (operator-probed honest UNKNOWN).**
Next (await owner go): NODE health-history read + UI (now has data); carrier health still has NO writer (would need a
carrier probe first); a real node reachability connector or heartbeat/dead-man's-switch (ADR); or LAND THE STACK (owner
provides GitHub remote → push `integration/phase-12o-complete` FF'd to feature tip → CI → PR). **NOTE: stack now spans
frontend + THREE backend endpoints (2as health-events read, 2at config-versions read, 2au node health-check write);
refresh the PR draft accordingly.**

**12O-2av (DONE)** — node HEALTH-EVENT HISTORY (read; consumes the NODE events the 2au probe now produces → the
follow-up promised in 2au). `GET /v1/telecom/nodes/:id/health-events` (platform + `telecom.health.read`; nodes.get→404
then history). New `NodeHealthService.history(nodeId, {limit, cursor})` — scoped `where {entityType: NODE, entityId}`,
shared `cursorArgs`/`toPage`, same safe view `{id, fromStatus, toStatus, reason, correlationId, createdAt}` (NEVER
echoes entityType/entityId/tenantId) as the engine history. **Identical shape+semantics to 12O-2as**, newest-first,
cursor-paginated (`HealthEventPage`). **NO schema change, NO new contract schema** — reuses the `HealthEvent` model +
`HealthEventPage`; contract adds the path only. Frontend: `listNodeHealthEvents` + `<NodeHealthHistoryDialog>` (nodes
have NO detail page → shown as a dialog from the Nodes list), per-row `telecom.health.read`-gated **"History"** button on
`<NodesView>`. +3 API unit (203→206, node-health.service.test: scoped-query + safe-view-no-leak + nextCursor/cursor
pass-through) + 4 web (dialog: renders/empty/load-more/error) + 2 web (nodes-view: History opens dialog, hidden w/o perm)
(230→236). API tsc✓ eslint✓ telecom 173✓; web build✓ eslint✓ suite 236✓ (37 files). e2e CI-only. 8 files + 2 new (dialog
+ its test), NO prisma. (48th commit; feature tip now <2av>; integration branch @5fcd64e now 29 behind.) **Node health
history now REAL — the probe writes NODE events, this reads them back.**
Next (await owner go): carrier health history still has NO writer (would need a carrier probe first, mirroring 2au→2av);
a real node reachability connector or heartbeat/dead-man's-switch (ADR); or LAND THE STACK (owner provides GitHub remote
→ push `integration/phase-12o-complete` FF'd to feature tip → CI → PR). **NOTE: stack now spans frontend + FOUR backend
endpoints (2as health-events read, 2at config-versions read, 2au node health-check write, 2av node health-events read);
refresh the PR draft accordingly.**

**12O-2aw (DONE)** — carrier HEALTH PROBE (write; event-only — the carrier analogue of 2au, unblocking carrier history 2ax).
**DISCOVERY corrected my own framing: NOT a clean mirror of 2au.** Carriers have NO health snapshot table (unlike `NodeHealth`),
and the carrier read's `health` was a HARDCODED literal `{UNKNOWN, "no health check configured"}` (carriers.service.ts). So I
STOPPED and surfaced the fork (schema change for a `CarrierHealth` table vs event-only); **owner chose EVENT-ONLY (no schema
change)**. `POST /v1/telecom/carriers/:id/health-check` (`telecom.health.read`; tenant-scoped via `@CurrentTenant`, NOT platform —
carriers are dual-nature). New `CarrierHealthService.probe(ctx, id, correlationId)` — scope-resolves the carrier (own + system →
404 foreign/unknown), **honest posture NEVER fabricated HEALTHY: DISABLED(admin) / UNCONFIGURED(no CarrierSipEndpoint) /
UNVERIFIED→UNKNOWN** — records a CARRIER HealthEvent on transition (carrier's tenantId; null for system). Carrier `health` now
**DERIVED** from the latest CARRIER event, replacing the literal: list computes per-page in **two bounded queries (groupBy newest
id → one fetch; NO N+1)**, get in one findFirst; `deriveHealth` → `{status, "last operator health probe"}` or `{UNKNOWN, "not yet
probed"}`. `@HttpCode(200)` (contract says 200; NOTE: node 2au health-check has no @HttpCode → 201 at runtime vs its contract's
200 — pre-existing node drift, left for a later node-align slice). **NO schema change** (reuses HealthEvent CARRIER entity).
Wired CarrierHealthService into telecom.module; audits `telecom.carrier.health_checked`. Contract: path + `CarrierHealthReport`
{carrierId,status,reachability,detail,correlationId,checkedAt}; `CarrierHealth` description refreshed. Frontend: `checkCarrierHealth`
+ per-row `telecom.health.read`-gated **"Check"** button on `<CarriersView>` (probes + reloads so the existing Health column
reflects it). +10 API unit (173→183: carrier-health.service posture/transition/unchanged/404/tenantId + carriers.service health
derivation get/list/no-N+1/empty) + 2 web (236→238 carriers-view: Check probes+reloads, hidden w/o telecom.health.read) + e2e
added to telecom-carrier.e2e (probe posture, derived health, DISABLED, 404 — **CI-only, NOT run here**, tsc-compiled). API tsc✓
eslint✓ telecom unit 183✓; web build✓ eslint✓ suite 238✓ (37 files). 10 files + 3 new (service + 2 tests), NO prisma.
(49th commit; feature tip now <2aw>; integration branch @5fcd64e now 30 behind.) **Carrier health now REAL (operator-probed honest
posture, derived from events).**
Next (await owner go): carrier health-history read + UI (2ax — now has data, mirrors 2av; carriers have no detail page → dialog
from the Carriers list) / a real node OR carrier reachability connector or heartbeat (ADR) / LAND THE STACK (owner provides GitHub
remote → push `integration/phase-12o-complete` FF'd to feature tip → CI → PR). **NOTE: stack now spans frontend + FIVE backend
endpoints (2as/2at/2au/2av + 2aw carrier health-check write); refresh the PR draft accordingly.**

### (superseded) sub-phase plan

**Phase 12M — real engine adapter (Kamailio first), built in additive review-gated sub-phases.** A disposable Kamailio 6.1.5 test engine is provisioned
(dedicated VPS 167.114.98.53, Ubuntu 24.04; management plane private behind
WireGuard + mTLS, Kamailio stopped/disabled, SIP ports closed; verified only SSH +
WireGuard exposed). Sub-phase plan: **12M-1 (DONE)** additive schema — `ENGINE_API`
credential type + `TelecomEngine.credentialId` vault reference (FK, SET NULL); **12M-2**
per-endpoint private-net SSRF allowlist **(DONE)**; **12M-3 (DONE)** real `KamailioJsonRpcConnector`
(read-only JSONRPC `core.version` health over mTLS, client cert from vault, honest health,
injectable transport, env-gated DI default-off); **12M-4** live plane bring-up on the VPS +
real integration test + flip `ENGINE_CONNECTOR=kamailio` (needs owner server steps — no SSH
from here); applied-version/`PENDING_RECONCILIATION` persistence deferred until a real
`applyConfiguration` (no engine↔resource model yet). After 12M-3: **API 255/255, web 13/13**,
typecheck ✓, lint ✓, build ✓. Next: await authorization for **Phase 12M-4** (live integration).

## EXISTING (the complete, verified inventory of this repository)

- `CLAUDE.md` — PROMAX Enterprise Engineering Constitution + Master Development Prompt
- `docs/` — this documentation set (13 documents + `ADR/`)
- `docs/ADR/0001-independent-product.md` — Accepted

**Nothing else exists.** No application code, no package manifest, no database,
no migrations, no tests, no CI, no Dockerfiles, no git repository initialized.

## PLANNED (committed by constitution/ADR, not yet built)

- Clean-architecture, API-first, contract-first system (OpenAPI authored before code)
- PostgreSQL datastore; UUIDv7 PKs; soft deletes; FKs everywhere; migrations-only schema changes
- Integer-minor-unit money on an append-only double-entry ledger; idempotent money posts
- argon2id auth, access+rotating-refresh tokens, TOTP MFA, deny-by-default RBAC, audit logs
- DID lifecycle as a guarded, audited state machine; day-one toll-fraud limits
- Real-backend-only slices with tests; docs + CHANGELOG updated per change

## PROPOSED (awaiting decision)

- Build strategy: contract-first vertical slices (DB+auth first, then DID core,
  then billing spine, then telecom integrations)
- Dev data plane via Docker compose; `git init` + remote for this repo

## UNKNOWN (needs owner input — Phase 1 blockers)

1. Technology stack (frontend / backend framework / ORM) → ADR-0002
2. Tenancy model: single-operator vs multi-customer/reseller hierarchy → ADR
3. User roles & personas (admin / customer / reseller?)
4. DID supply chain: which carrier(s)/provider(s), API vs manual ordering
5. Billing model: prepaid wallet vs postpaid invoicing; payment rails
6. Launch market(s) → regulatory surface (SHAKEN, emergency services, KYC)
7. Hosting target & deploy pattern
8. Expected scale (customers, DIDs, CDR volume)

## Next actions

1. Owner answers the UNKNOWN list (or asks for grounded proposals per item)
2. Lock ADR-0002 (stack) + ADR-0003 (tenancy)
3. Initialize git; scaffold repo; then Phase-1 vertical (DB + auth + first DID API + portal shell)

## Session log

| Date | Summary |
|---|---|
| 2026-08-26 | Workspace inspected — confirmed greenfield (zero Telvyn code anywhere). Docs skeleton + ADR-0001 created. |
| 2026-08-26 | Root CLAUDE.md constitution created. Docs revised to EXISTING/PLANNED/PROPOSED/UNKNOWN taxonomy. |
| 2026-08-26 | Full 16-domain architecture audit performed; ARCHITECTURE.md rewritten with per-component failure modes, scaling, and security risks. |
| 2026-08-26 | Database audit: no DB artifacts exist; findings DB-001…008 registered (CRITICAL gate: isolation mechanism DB-002; HIGH: billing model DB-003, ORM lane DB-004). |
| 2026-08-26 | Security audit: repo scan clean (no secrets/PII); findings SEC-001…009 registered (CRITICAL: isolation SEC-001; HIGH: toll-fraud spec SEC-002, no git/CI enforcement SEC-003). |
| 2026-08-26 | UI/UX audit: no UI exists; owner locked the PROMAX design mandate (NOC + fintech + premium SaaS, NOT generic dashboard) — codified in UI_UX.md with 25-area acceptance contract; design phase (brand + direction boards) is now a gate before first screen. |
| 2026-08-26 | Telvyn PROMAX Design System v0.1 designed: ink+Signal palette, Space Grotesk/IBM Plex pairing, 3-mode theming, WCAG 2.2 AA, 20 component contracts. Reference sheet at docs/design/telvyn-design-system.html — awaiting owner approval (UX-002 gate). |
| 2026-08-26 | Owner locked the 20-phase master build program — recorded in docs/ROADMAP.md with per-phase gates + dependency spine. Phase 5 (design system) is furthest along (v0.1 awaiting approval); Phase 1 blocked only on ADR-0002 stack. |
| 2026-08-26 | Owner APPROVED design system v0.1 (UX-002 gate closed). Phase 5 now waits only on ADR-0002 stack for component implementation. |
| 2026-08-26 | **Phase 1 frontend shell SHIPPED** (commit 2b18890): ADR-0002 accepted (Next.js 15/Tailwind v4/shadcn-style), monorepo + git initialized, full application shell on approved tokens, 13 tests + typecheck + build green, runtime-verified incl. dark mode + mobile. Dev server: `npx pnpm@9 --dir "D:/Claude Dev/portal.telvyn.co" --filter @telvyn/web dev` → http://localhost:3211. Next: backend-stack ADR + tenancy decision → Phases 2/3. |
| 2026-08-27 | **Phase 2 Authentication foundation IMPLEMENTED.** ADR-0003 (NestJS + Prisma + PG18 + Redis). Contract-first OpenAPI (telvyn.v1.yaml). Full auth: login (+no-enumeration), JWT access + rotating refresh w/ reuse detection, sessions/devices/revocation/logout-all, TOTP MFA + recovery codes + step-up, password reset + email verification (EmailOutbox seam), rate limiting (Redis, fail-closed) + progressive lockout, SecurityEvent/LoginAttempt audit + owner history endpoints, argon2id, RFC7807 errors, secure httpOnly SameSite=Strict refresh cookie. No migration needed (only prior "auth" was the null-session shell seam). Verified: typecheck clean, 7 unit tests, prisma generate + schema valid, build → dist/main.js, env fail-fast. **13-scenario e2e suite written but NOT run here** (no docker/DB access in this env). |
| 2026-08-27 | **Phases 3+4 Authorization foundation IMPLEMENTED.** ADR-0004 resolves DB-002/SEC-001 (CRITICAL) — tenant isolation server-enforced (session-derived tenant, scoped Prisma extension deny-by-default, RLS defense-in-depth SQL). Tenant/Membership/Role/Permission/PermissionGroup/RolePermission/MembershipRole/AuditLog models; system roles owner/admin/operator/auditor + tenant custom roles + wildcard grants; deny-by-default @RequirePermissions guard; audit on all authz mutations. Endpoints: tenant, members, member roles, roles CRUD, permission catalog, audit-logs. Access token gains `tid`; Session gains tenantId (additive). Verified: typecheck, **26 API unit tests**, build, web 13/13. **e2e (cross-tenant/IDOR/priv-esc/unauth/client-tenant-ignored) written, NOT run here** (no DB access). Seed + create-tenant CLI + RLS SQL are the deploy steps. |
| 2026-08-27 | **Auth + authz e2e GREEN (48/48) against real Postgres+Redis.** First live run surfaced 3 real bugs, all fixed (commit 0bbf140): (1) Nest DI under Vitest needed SWC to emit decorator metadata; (2) tenant context was lost guard→handler — now seeded by TenantContextMiddleware + filled by guard (AsyncLocalStorage); (3) ProblemFilter surfaced generic status name over the real message. Local dev runs on the machine's PostgreSQL 17 (no Docker) via a `uuidv7()` polyfill (`apps/api/prisma/pg17-uuidv7.sql`) + `.env` at localhost:5432/6379; compose path still targets PG18. DB `telvyn`/role `telvyn` created; migration `20260826204653_init` applied; catalog seeded. |
| 2026-08-27 | **Session saved.** API verified running live on real PG17+Redis: login→me→tenant→bad-password all correct (token issued, RBAC route works). Runtime fixes landed: dotenv auto-load (no more $env: needed), self-contained uuidv7 migration, CLI `--` tolerance, dev/start via `node -r @swc-node/register` (emits decorator metadata + resolves `@/`). Working tree clean at 1c36757. **Resume point:** build the Phase-2 frontend screens (login/MFA/session) against the proven API, OR Phase 6 admin console (tenant/roles/members endpoints ready). Backend Phases 1–4 complete + e2e green (48/48). |
| 2026-08-29 | **Phase 1–11 completion audit (independent).** Verified: backend auth + tenancy + RBAC are real, well-architected, and covered by comprehensive tests. Executed this session: 26 unit tests PASS, typecheck clean (both apps). NOT executed: 22 integration/e2e tests (local PG :5432 + Redis :6379 down — environment, not code; previously 48/48 green). **Status corrections:** roadmap Phases 2–4 (auth/tenant/RBAC backend) = COMPLETE (pending e2e re-run); **Phase 5 (Auth FRONTEND) = NOT IMPLEMENTED** (web is a static shell with zero backend calls, honest `session.user=null` seam — not fake auth); Phases 6–11 = NOT STARTED. **Gaps to fix before proceeding:** (1) re-run e2e green vs live services; (2) no CI/CD (SEC-003 open); (3) no HTTP security headers (helmet/CSP/HSTS); (4) RLS written but not operative (app-layer scope active+tested). No P0/P1 defects. Verdict: **NOT READY for next phase** until 1–3 land. |
| 2026-08-29 | **P1 blockers fixed & verified** (audit follow-up; P0/P1 only, no new features). **P1-1 (SEC-003, no CI/lint) RESOLVED:** added ESLint flat config + lint scripts (both apps + root, all clean) and `.github/workflows/ci.yml` — on every push/PR it runs prisma generate, typecheck, lint, migrate+seed, the FULL suite (unit + e2e vs postgres:18 + redis service containers), and the web production build, plus an advisory `pnpm audit` job. **P1-2 (e2e unverified) RESOLVED:** stood up the local data plane and ran the full suite **48/48 green** (all 22 e2e: cross-tenant, IDOR, priv-esc, client-supplied-tenantId-ignored, auth/MFA/refresh-reuse); CI now runs e2e on every push (durable). No application or security code changed — guards/tenant-scoping/auth untouched; only lint/CI config + a stale eslint-disable removal. Verified locally: typecheck ✓, lint ✓, 48/48 ✓, web build ✓ (commit 3c2537b). **Remaining before Phase 12 (P2, out of this scope):** HTTP security headers (helmet), RLS operative, Phase-5 auth frontend. |
| 2026-08-29 | **Pre-Phase-12 security hardening (P2 items 1–4).** API helmet (JSON-tuned CSP `default-src 'none'`, DENY, no-referrer, CORP same-site, Permissions-Policy, prod-only HSTS) + header regression tests. Web nonce-based CSP (prod-only middleware; `script-src` nonce+strict-dynamic, no unsafe-eval; style unsafe-inline documented for Radix) + Permissions-Policy + prod-only HSTS; nonce wired to next-themes. **Verified live** on the production build (all scripts nonced, theme inline script executed, hydrated, 0 CSP violations) + 3 API header tests. **RLS DEFERRED** (ADR-0005) with a 5-step staged activation plan — app-layer scoped client stays the tested isolation control; not forced. **Auth frontend: INCOMPLETE**, documented as the next phase (null-session seam intact, no fake auth). Regression clean: **API 51/51, web 13/13**, typecheck ✓, lint ✓, web prod build ✓. Remaining before Phase 12: build the auth frontend; activate RLS per ADR-0005 before multi-worker/prod. |
| 2026-08-29 | **Phase 12A COMPLETE — telecom control-plane architecture + domain boundaries** (docs/ADRs only; no schema/code, per one-sub-phase-at-a-time). Added ADR-0006..0010 (control/data plane; provider-neutral engine abstraction w/ honest NOT-IMPLEMENTED adapters; carrier platform-vs-tenant + system-or-tenant read mode; TelecomCredential secret vault; node config-vs-runtime + health model). Expanded TELECOM.md (15 boundaries, table-vs-deferred split, security model, RBAC keys). Owner-approved decisions locked: 12K = reusable UI components only (no API-wired screens, no auth-frontend dependency); Endpoint/CodecPolicy/NumberingPlan/FailoverPolicy = fields for now; Registration/CallSession = runtime not persisted; dedicated credential vault. **No code touched — baseline preserved (API 51/51, web 13/13).** Next: await authorization for **Phase 12B (database foundation)**. |
| 2026-08-29 | **Phase 12B COMPLETE — telecom database foundation.** Additive migration `20260829002712_telecom_foundation`: 15 enums + 14 tables (Region, TelecomEngine, EngineCapability, TelecomNode, NodeHealth, HealthEvent, Carrier, CarrierSipEndpoint, SipTrunk, Did, RoutingProfile, RoutingRule, TelecomCredential vault, TelecomConfigVersion) + 27 indexes + 20 FKs. **Safety: reviewed via `--create-only` before apply — zero destructive ops, zero changes to existing tables** (Tenant back-relations are virtual). Applied to dev + client regenerated + 14 tables verified. RBAC: +14 permissions in new `telecom` group, admin/operator/auditor grants updated (owner `*` auto-covers; `telecom.manage` owner-only), seed re-synced (26 perms, 4 roles). **No services/APIs yet.** Regression clean: **API 51/51**, typecheck ✓, lint ✓; web untouched (13/13). Next: await authorization for **Phase 12C — Telecom Engine Abstraction**. |
| 2026-08-29 | **Phase 12C COMPLETE — telecom engine abstraction (ADR-0007).** Added `TelecomEngineAdapter` interface, `EngineRegistryService` (type→adapter map), and honest stub adapters `KamailioAdapter`/`AsteriskAdapter`/`FreeSwitchAdapter` — `implemented=false`, `healthCheck()` returns UNKNOWN (never fake HEALTHY), static capability profiles reflect real software facts (Kamailio declares no RTP/media; Asterisk/FreeSWITCH media-capable). `TelecomModule` wired into AppModule (providers only — no controllers, no DB access yet). 7 pure unit tests (no DB). **No schema/migration/API changes.** Regression clean: **API 58/58** (51 + 7 new), typecheck ✓, lint ✓; web untouched (13/13). Next: await authorization for **Phase 12D — Region + Node model** (services + APIs for platform infra). |
| 2026-08-29 | **Phase 12D COMPLETE — platform telecom infrastructure (Region/Engine/Node).** Added `/v1/telecom/{regions,engines,nodes}` services+controllers (CRUD + engine capability config + node health read) on the 12B tables. **New `PlatformGuard`** + `tenantType` on TenantContext (loaded by TenantGuard) — platform infra is restricted to PLATFORM-tenant members; a CUSTOMER owner holding `*` is refused (403), proven by e2e. Zod validation, referential-integrity checks, all mutations audited via existing AuditService, honest health (UNKNOWN) + honest adapter metadata (implemented=false, software vs enabled capabilities). 4 e2e tests. **No schema/migration changes.** Regression clean: **API 62/62** (58 + 4), typecheck ✓, lint ✓; web untouched (13/13). Next: await authorization for **Phase 12E — Carrier foundation** (incl. the system-or-tenant scope helper + TelecomCredential vault service). |
| 2026-08-29 | **Phase 12E COMPLETE — carrier foundation.** `/v1/telecom/carriers` CRUD + `TelecomCredentialService` vault, on the 12B tables (**no schema/migration change**). Dual-nature system/tenant scope (ADR-0008) via new tested `systemOrTenantWhere`/`authorizeDualNatureWrite`/`ownerTenantIdForCreate` helpers in tenant-scope.ts; added `tenantType`-derived `isPlatform`. Secrets (ADR-0009): vault-only AES-256-GCM, credential `select` omits `secretEnc`, never in response/list/audit/logs, decrypt only in `revealForAdapter`; cross-tenant attach → 404, system attach by tenant → 403 (all e2e-proven, incl. secret-string-absent assertions). Cursor pagination + filters. RBAC reuses 12B carrier.* (owner=*, admin=carrier.*, operator/auditor=carrier.read). Soft delete. Honest health UNKNOWN. **Regression: API 73/73 (62 + 11), web 13/13, typecheck ✓, lint ✓.** Routing note: `/v1/telecom/carriers` (12D convention) not `/v1/carriers`. OpenAPI YAML debt preserved. Next: await authorization for **Phase 12F — SIP trunk foundation**. |
| 2026-08-29 | **Phase 12F COMPLETE — SIP trunk foundation** (control-plane config only; NO SIP/RTP runtime, no live connectivity). Additive migration `sip_trunk_carrier_link` (`SipTrunk.carrierId` required FK + index; --create-only reviewed, table 0 rows → safe). `/v1/telecom/sip-trunks` CRUD; **SipTrunk added to TENANT_SCOPED_MODELS** (first telecom model on the auto-scoping client → deny-by-default + IDOR-safe reads/create; update/delete raw-by-id after scoped ownership check since Prisma unique-where can't be AND-wrapped). Carrier must be caller-accessible (own/system via systemOrTenantWhere, else 400); credential ownership + SIP_PASSWORD type enforced (foreign→404, system→403, wrong-type→400, deleted→404); secrets vault-only, never in response/list/audit (asserted). SSRF/CRLF-hardened host/sipUri validation (no control chars, sip(s): scheme only); **no outbound connections** — future probing needs egress allowlisting (documented). RBAC reuses 12B sip_trunk.*. Soft delete, honest health UNKNOWN, mass-assignment safe. **Regression: API 84/84 (73 + 11), web 13/13, typecheck ✓, lint ✓, build ✓.** Next: await authorization for **Phase 12G — DID foundation**. |
| 2026-08-29 | **Phase 12G COMPLETE — DID foundation** (control-plane only; NO SIP/RTP/routing runtime). Additive migration `did_sip_trunk_link` (`Did.sipTrunkId` nullable FK SetNull + indexes sipTrunkId/routingProfileId/regionId/country; --create-only reviewed, no destructive ops). `/v1/telecom/dids` CRUD; **Did added to TENANT_SCOPED_MODELS** (auto-scoped tenant isolation + IDOR). **E.164 via libphonenumber-js** (new dep): canonical store, country derived from number (not client). **Uniqueness = GLOBAL plain @unique on e164** (12B kept; duplicate incl. alt-format → 409; partial-unique recycle-after-soft-delete deferred, no data conflict). DID=tenant-owned (nullable-tenantId platform pool NOT exposed by API — no system DIDs invented). Relationship auth: carrier accessible (systemOrTenantWhere), trunk/profile same-tenant, region exists; carrier↔trunk consistency; foreign/deleted → 400. Soft delete, SET NULL relations (no cascade to carrier/trunk/profile/region), honest health UNKNOWN, mass-assignment safe (create strips unknowns, update .strict()). RBAC reuses did.read/did.manage. **Regression: API 95/95 (84 + 11), web 13/13, typecheck ✓, lint ✓, build ✓.** ENV NOTE: pgsql cluster lost seed data mid-session (down/reset) → re-seeded (26 perms); **verify `prisma db seed` after any local cluster restart**. Next: await authorization for **Phase 12H — Routing profile foundation**. |
| 2026-08-29 | **Phase 12H COMPLETE — routing profile foundation** (declarative config only; NO SIP/webhook/failover/LCR/CDR runtime). Additive migration `routing_rule_config` (new enum RoutingDestinationType; RoutingRule + destinationType NOT NULL [empty table] + timeoutSeconds/retryCount/schedule JSONB; --create-only reviewed, no destructive ops). `/v1/telecom/routing-profiles` CRUD with **embedded rules** (PATCH `rules` replaces atomically); **RoutingProfile joined TENANT_SCOPED_MODELS**. Typed destinations (SIP_TRUNK owned-trunk validated / PHONE_NUMBER canonical E.164 / EXTENSION / VOICEMAIL / **WEBHOOK https-public SSRF-validated, never called**); **deterministic ordering priority ASC then id ASC**; bounded retry(0-10)/timeout(1-600); schedule timezone IANA-validated via Intl (no server-local assumption). Carrier ref accessible-checked. Duplicate name→409. Soft delete, no cascade, mass-assignment safe. RBAC reuses routing.read/routing.manage. **Regression: API 105/105 (95 + 10), web 13/13, typecheck ✓, lint ✓, build ✓.** Next: await authorization for **Phase 12I — Health framework**. |
| 2026-08-29 | **Phase 12I COMPLETE — routing policy + failover foundation** (declarative config only; NO SIP/webhook/failover/LCR/CDR runtime). Additive migration `routing_policy_failover` (enums RoutingSelectionStrategy + RoutingFailoverCondition; **RoutingProfile** policy fields selectionStrategy/failoverEnabled/failoverConditions[]/maxAttempts/overallTimeoutSeconds + **version** for optimistic-concurrency; **RoutingRule** weight + failoverDestinationType — all NOT NULL cols have defaults, safe; **NO new FailoverPolicy table** — policy is 1:1 with profile). Extends 12H (not rebuilt): typed failover destinations (validated like primary), declarative failover conditions (failoverEnabled requires ≥1 condition), **loop protection** (self-failover rejected incl. normalized phone numbers; bounded maxAttempts 1-20/retry 0-10/timeouts), **atomic optimistic-concurrency updates** (PATCH expectedVersion → 409 on mismatch via atomic updateMany WHERE version; version auto-increments; rule replacement all-or-nothing, validation before txn). WEIGHTED strategy uses rule.weight (config). Deterministic order unchanged. Future engine adapter (ADR-0007) will consume this config → data plane. **Regression: API 111/111 (105 + 6), web 13/13, typecheck ✓, lint ✓, build ✓.** Next: await authorization for **Phase 12J** (API integration / OpenAPI). |
| 2026-08-29 | **Phase 12J COMPLETE — routing decision + LCR policy foundation** (declarative route SELECTION only; NO execution/rating/billing/wallet/SIP/CDR). Additive migration `lcr_policy`: enums **Currency** (first; USD/EUR/GBP/INR/AUD/CAD/JPY, not USD-only) + **LcrSelectionStrategy**; tables **LcrPolicy** (tenant-owned, strategy + version) + **LcrRoute** (candidates: carrier(req)/trunk(opt) refs, prefix, country, **costMicros BigInt micro-units [no float]**, currency, priority, weight, enabled, effectiveFrom/To). `LcrPolicy` joined TENANT_SCOPED_MODELS. `/v1/telecom/lcr-policies` CRUD (embedded routes, replace-on-PATCH). **Deterministic candidate ordering** per strategy via pure `orderCandidates` (LOWEST_COST/HIGHEST_PRIORITY/WEIGHTED/QUALITY_FIRST; stable id tie-break; QUALITY_FIRST honest fallback — no health subsystem). Carrier accessible (systemOrTenantWhere) + trunk owned; cost non-negative/bounded/no-NaN; effectiveFrom<To; overlap NOT constrained (LCR needs multiple candidates). Atomic optimistic-concurrency (version/expectedVersion→409); mass-assignment safe; no secrets in LCR. **LCR selection ≠ rating ≠ billing (separate/future); no FX in LCR.** RBAC reuses routing.read/routing.manage (no new perms). Future decision contract documented (→ engine adapter). **Regression: API 124/124 (111 + 13), web 13/13, typecheck ✓, lint ✓, build ✓.** Next: await authorization for **Phase 12K**. |
| 2026-09-01 | **Phase 12K COMPLETE — telecom engine foundation + engine abstraction** (control-plane abstraction only; NO SIP/RTP/engine runtime, no carrier connectivity, no CDR/billing). **No migration** — reuses the 12C `TelecomEngineAdapter`/`EngineRegistryService` and the 12D engine/node/health model + 12E-0009 credential vault. New provider-neutral `engine.types.ts`: `EngineCapabilities` *operation* profile (health/routing/registration/activeCalls/originate/configuration — distinct from `EngineCapability` feature rows), `EngineHealthResult`, `EngineContext` (correlationId + bounded timeout), `EngineStatus`, normalized `EngineErrorCode`/`EngineError`, `EngineOperationResult`, and **secret-free** `EngineConfigurationIntent` (credentials → `credentialRef` id only). Adapters gained explicit `capabilities()` — **honest per class: Kamailio `originate:false` (SIP router); Asterisk/FreeSWITCH `originate:true` (B2BUA/softswitch)** — and `applyConfiguration()` throwing `NOT_IMPLEMENTED` (no fake success, health stays UNKNOWN). New **`EngineService`**: registry-resolved adapters only (unsupported rejected; never dynamic instantiation / tenant-controlled class names), **bounded-timeout guard** (default 5s, hard cap 30s, never infinite) via Promise.race, correlation IDs, structured **secret-free** logging, uniform `normalizeError` (unknown-error detail suppressed — no leakage), pure `buildConfigurationIntent`. Platform-only endpoints (PlatformGuard): `GET /v1/telecom/engines/:id/status` (explicit capabilities + honest UNKNOWN health + correlationId) and `POST /v1/telecom/engines/:id/sync` (→ **HTTP 501 NOT_IMPLEMENTED**, always audited `telecom.engine.sync_attempted`; NOT_IMPLEMENTED→501/TIMEOUT→504/else 503). Customer tenant 403 even as owner; unauth 401; nonexistent 404. RBAC reuses telecom.health.read/telecom.manage (no new perms). ADR-0007 addendum added; no new ADR. +10 tests (6 unit + 4 e2e incl. secret-absent asserts). **Regression: API 134/134 (124 + 10), web 13/13, typecheck ✓, lint ✓, build ✓.** Next: await authorization for **Phase 12L** (real engine adapter / live SIP — NOT started). |
| 2026-09-01 | **Phase 12L COMPLETE — engine runtime integration foundation** (secure integration seams ONLY; NO live SIP/RTP/engine runtime, **no network egress**). Discovery: **no real telecom engine exists** (Postgres+Redis only) → adapters stay honest, connector is a no-egress `NullEngineConnector`. **No migration** — reuses `TelecomConfigVersion` (append-only versioning) + `HealthEvent` (transitions). New `engines/runtime/`: **canonical SSRF egress policy** (`engine-endpoint.ts` — http(s)+public-host only; blocks loopback/RFC1918/CGNAT/link-local+cloud-metadata/ULA/multicast/reserved/IPv4-mapped+NAT64/alt-representations; connect-time DNS-rebinding recheck) wired as the active gate on engine `endpoint` config (create/update→400) AND pre-connect; `connection-profiles.ts` (typed per-provider mgmt mechanism — Kamailio JSONRPC/Asterisk ARI/FreeSWITCH mod_xml_rpc, NO raw ESL/AMI — + bounded timeout/retry/backoff); `EngineConnector`+`NullEngineConnector`; `EngineConnectionManager` (normalized reachability UNCONFIGURED/DISABLED/BLOCKED/UNVERIFIED/REACHABLE/UNREACHABLE, BLOCKED refused before any connector call); `EngineHealthService` (honest health mapping, HealthEvent only on transition); `EngineSyncService` (deterministic SHA-256 **fingerprint** of secret-free intent = desired version; append-only history; **idempotent** decideSync; **stale-safe rollback** decideRollback re-proposes prior version never deletes; fail-closed Redis `SET NX` **concurrency mutex**; apply delegates to adapter → honest NOT_IMPLEMENTED so **appliedVersion never advances/stays null** — persisting applied state deferred to first real adapter per ADR-0011). Platform-only endpoints (reuse telecom.health.read/telecom.manage): richer `GET :id/status` (+connection+version posture), `POST :id/health-check` (audited telecom.engine.health_checked), versioned `POST :id/sync` (concurrent→409, lock-outage→503, honest 501), `POST :id/sync/rollback` (no-previous→400, audited). Typed operations only — NO command/dialplan/XML injection; secrets never leave the vault. **New ADR-0011**; UI deferred (honest UNKNOWN/UNAVAILABLE, no auth frontend to host a NOC view, no fake metrics). +56 tests (49 unit incl. exhaustive SSRF + 7 e2e). **Regression: API 190/190 (134 + 56), web 13/13, typecheck ✓, lint ✓, build ✓.** Next: await authorization for **Phase 12M** (real engine adapter / live SIP — NOT started). |
| 2026-10-15 | **Phase 12M-A COMPLETE — engine sync mutex fail-closed coverage** (test-only; no production change). Verdict READY-FOR-INFRASTRUCTURE (real-engine gate still unmet — `NullEngineConnector` remains the only connector). Added `engine-lock.service.test.ts` (+6 unit, fake Redis): own-token compare-and-delete release, TTL floor ≥1000ms, `EngineLockBusy` on contention, **fail-closed `EngineLockUnavailable` on Redis outage**, release-on-throw. **Regression: API 196/196 (190 + 6), web 13/13, typecheck ✓, lint ✓.** (commit 62dd530). Next: await authorization for **Phase 12M** (real engine adapter). |
| 2026-11-16 | **Phase 12M-1 COMPLETE — engine credential reference (additive schema).** First sub-phase of the real Kamailio adapter. Disposable Kamailio 6.1.5 test engine provisioned on dedicated VPS 167.114.98.53 (Ubuntu 24.04; mgmt plane private behind WireGuard + mTLS; Kamailio stopped/disabled; SIP closed; only SSH + WireGuard exposed — verified). Additive migration `engine_credential_ref` (reviewed `--create-only`, **zero destructive ops**, TelecomEngine 0 rows): `TelecomCredentialType.ENGINE_API`; `TelecomEngine.credentialId` nullable FK → `TelecomCredential` `ON DELETE SET NULL` + index; `TelecomCredential.engines` back-relation. Reference only — secrets stay vault-encrypted (ADR-0009), decrypted solely at the adapter boundary; applied-version persistence will use the append-only snapshot-flag route (no column) per the ADR-0011 addendum. **No behavior/DI/egress change** (`NullEngineConnector` still the only connector). +3 integration tests (ENGINE_API usable; engine↔credential link; SET NULL on credential delete). **Regression: API 199/199 (196 + 3), web 13/13, typecheck ✓, lint ✓.** Next: await authorization for **Phase 12M-2** (per-endpoint private-net SSRF allowlist). |
| 2026-11-17 | **Phase 12M-2 COMPLETE — engine management private-network SSRF allowlist.** Extends the canonical egress policy (`engine-endpoint.ts`) so a real engine can be reached over a PRIVATE transport (WireGuard + mTLS gateway) while RFC1918 stays denied by default. Narrow explicit allowlist from platform env `ENGINE_MGMT_ALLOWLIST` (`CIDR@port[;port…]`): authorizes a **specific IP + port individually** — IPv4 `/24..32` (blanket `10/8`·`172.16/12`·`192.168/16` rejected), IPv6 exact `/128`, port mandatory, matched on the **IP address only** (a hostname can never be allowlisted → DNS-rebinding defeated); enforced at config time AND the connect-time `assertResolvedIpAllowed` recheck. Malformed entries dropped (fail-closed); **unset = prior strict public-only policy, unchanged** (all 49 existing SSRF tests pass untouched). NO egress (`NullEngineConnector` still wired), NO schema/DI change. +37 unit tests. ADR-0011 addendum + SECURITY.md + `.env.example` updated. **Regression: API 236/236 (199 + 37), web 13/13, typecheck ✓, lint ✓, build ✓.** Next: await authorization for **Phase 12M-3** (real `KamailioJsonRpcConnector` + applied-version persistence + env-gated DI). |
| 2026-11-17 | **Phase 12M-3 COMPLETE — real Kamailio management connector (read-only health).** First real engine connector: a JSONRPC `core.version` **health probe** over the private mTLS gateway, **off by default**. New `KamailioJsonRpcConnector` (honest health — valid version→HEALTHY, answered-but-not-OK→UNHEALTHY, unreachable→UNKNOWN; transport failures mapped to a safe fixed vocabulary, no raw provider/TLS text), single injectable network seam `EngineHttpTransport` + real `NodeHttpsEngineTransport` (https+mTLS, server-cert verified, **connect-time rebinding recheck** via the 12M-2 allowlist, bounded timeouts, capped body), **env-gated DI factory** (`ENGINE_CONNECTOR=kamailio` engages it; unset/other→`NullEngineConnector`). mTLS client cert = vault `ENGINE_API` credential, decrypted only at the boundary (`revealForAdapter`), never cached/logged/returned (test-proven the key never leaks into a `detail`). `credentialId` threaded engine→health→connection→probe; engine view now surfaces non-secret `credentialId`. **No migration; default behavior unchanged** (NullEngineConnector wired with flag off → all existing e2e pass). Applied-version/`PENDING_RECONCILIATION` persistence deferred (only meaningful once `applyConfiguration` does real network work — no engine↔resource model yet). +19 unit tests (connector logic, env-gated selection, transport https guard; the live network path is integration-tested in 12M-4). ADR-0011 addendum + SECURITY.md + `.env.example` updated. **Regression: API 255/255 (236 + 19), web 13/13, typecheck ✓, lint ✓, build ✓.** Next: await authorization for **Phase 12M-4** (live plane bring-up on the VPS + real integration test + flip `ENGINE_CONNECTOR=kamailio`; needs owner server steps). |
| 2026-11-17 | **Phase 12M-4 COMPLETE — live Kamailio engine integration PROVEN; Phase 12M DONE.** Brought the private management plane live on the VPS (`167.114.98.53`): Kamailio JSONRPC on loopback `:8000` (xhttp + jsonrpcs, `/RPC`, localhost-only), nginx **mTLS gateway** on `wg0:8443` → `127.0.0.1:8000/RPC`, CA + server(SAN IP:10.9.0.1) + client certs, and a **WireGuard** tunnel (VPS `10.9.0.1` ↔ dev host `10.9.0.2`). The client key was generated on the dev host (never transited chat); the VPS CA signed its CSR. Ran the REAL `KamailioJsonRpcConnector` (no mocks) — vault decrypt → `NodeHttpsEngineTransport` (mTLS + connect-time rebinding recheck via the 12M-2 allowlist) → gateway → `core.version` → **HEALTHY, `reachable — kamailio 6.1.5`, ~750ms**. Committed `scripts/probe-live-engine.ts` + **opt-in** `test/telecom-engine-live.e2e.test.ts` (skipped unless `ENGINE_LIVE_MTLS_DIR` set → baseline unaffected). RUNBOOK.md + SECURITY.md + ADR-0011 updated with the real procedure and gotchas (wg-quick dropping the wg0 Address; stale-apt 404 from a 101-day hung lock; MITM-antivirus TLS interception on the dev host → `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; Windows schannel can't load PEM client certs). No production-code change (connector/transport shipped in 12M-3). **Regression: API 255/255 (+1 opt-in live PASS, 1 skipped by default), web 13/13, typecheck ✓, lint ✓, build ✓.** Applied-version persistence remains deferred (needs a real `applyConfiguration` + engine↔resource model). Next: await owner direction. |
| 2026-11-17 | **Phase 12N-1 COMPLETE — engine↔resource assignment model (additive schema).** First sub-phase of making an engine's desired config non-empty. Additive migration `engine_resource_assignment` (ADR-0012; reviewed, no existing table changed): `enum EngineResourceKind` (SIP_TRUNK/DID/ROUTING_PROFILE) + `EngineResourceAssignment` — `engineId` FK (Cascade), denormalized `tenantId` FK (Cascade; null = platform), three explicit nullable resource FKs (`sipTrunkId`/`didId`/`routingProfileId`, each Cascade) — real FKs, NOT a polymorphic id (constitution: no FK-less tables). **DB CHECK** enforces exactly-one-resource-matching-kind; per-kind `@@unique([engineId,<resourceId>])` bars double assignment; `enabled` + soft delete. Carriers are NOT directly assignable (implied by trunks). Platform-managed (API in 12N-2); no service/API/behavior change. +4 integration tests (assign each kind; unique; CHECK rejects zero/two/kind-mismatch; cascades on engine + resource delete). ADR-0012 + DATABASE.md + ADR index. **Regression: API 259/259 (255 + 4), web 13/13, typecheck ✓, lint ✓.** Next: await authorization for **Phase 12N-2** (assignment service + platform API + RBAC + audit). |
| 2026-11-17 | **Phase 12N-2 COMPLETE — engine resource assignment service + platform API.** `EngineAssignmentsService` + `EngineAssignmentsController` under `/v1/telecom/engines/:engineId/assignments` (PlatformGuard — customer 403, unauth 401). `POST {kind, resourceId}` validates the resource against the table implied by `kind` (missing → 404) and derives `tenantId` from the resource's owner (**never client-supplied**); already-assigned → **409**; re-assigning a previously-unassigned resource **reactivates** it (soft-delete preserved, no unique conflict). `GET` lists active assignments (+ non-secret resource label); `PATCH :id {enabled}` toggles; `DELETE :id` soft-unassigns (204). RBAC reuses telecom.read/telecom.manage (no new perms); every mutation audited (`telecom.engine.resource_{assigned,assignment_updated,unassigned}`). No schema change; no config pushed (feeds the desired intent in 12N-3). +7 e2e (assign/list, 409 double, 404 missing, DID+profile, enable→unassign→reactivate, customer 403 + unauth 401). API.md updated. **Regression: API 266/266 (259 + 7), web 13/13, typecheck ✓, lint ✓.** Next: await authorization for **Phase 12N-3** (wire assignments into buildConfigurationIntent). |
| 2026-11-17 | **Phase 12N-3 COMPLETE — desired config intent from assignments.** `EngineSyncService.desiredIntent` now builds the intent from the engine's ENABLED, non-deleted assignments via new `EngineAssignmentsService.buildConfigurationSource` (secret-free: trunks/DIDs/routing-profile-rules → intent; carriers derived from assigned trunks'/DIDs' carriers, priority 0 — no per-engine carrier ordering yet; soft-deleted/disabled resources excluded; deterministic order) — so the config **fingerprint is now meaningful** (was always empty). `GET :id/status` gains a live read-only `desired` preview (`{version, summary{carriers,trunks,dids,routes}}`); `POST :id/sync` records the non-empty desired version. **No config pushed** (connector still honest NOT_IMPLEMENTED until 12N-4); no schema change. `EngineSyncService` gained an `EngineAssignmentsService` dep (its unit test updated). +3 e2e (empty→populated→disabled: counts + fingerprint change). API.md updated. **Regression: API 269/269 (266 + 3), web 13/13, typecheck ✓, lint ✓.** Next: await authorization for **Phase 12N-4** (real applyConfiguration + applied-version persistence). |
| 2026-11-17 | **Phase 12N-4a COMPLETE — applied-version persistence + reconciliation state machine** (no engine mutation). Implements the applied-version route ADR-0011 deferred. Pure `decideApplyOutcome`: success → **APPLIED** (append `applied` snapshot, advance applied version); **TIMEOUT → PENDING_RECONCILIATION** (append `reconcile_pending` snapshot; engine state UNKNOWN, applied NEVER advanced); other failure → **FAILED** (no snapshot, retryable). Wired into `EngineSyncService.sync`/`rollback` via `recordApplyOutcome`; `posture()` + `GET :id/status.version` + `POST :id/sync` + sync audit surface `syncState`. Append-only snapshot route — **no migration**. Adapter still a stub → every real apply `NOT_IMPLEMENTED → FAILED`, applied stays `null` (honest); machinery complete + tested. **ADR-0013 (Proposed)** records the real apply mechanism (Kamailio htable-via-RPC) for 12N-4b — mutates a live engine, needs owner approval + a one-line VPS `kamailio.cfg` addition. +5 unit tests (decideApplyOutcome; APPLIED/PENDING_RECONCILIATION/FAILED paths; posture lifecycle). ADR-0011 addendum + API.md. **Regression: API 274/274 (269 + 5), web 13/13, typecheck ✓, lint ✓.** Next: owner approves ADR-0013 → **Phase 12N-4b** (the real mutating apply). |
| 2026-11-17 | **Phase 12N-4b COMPLETE (mechanism; live mutation operator-gated) — real Kamailio htable config apply, ADR-0013 Accepted.** The first state-changing engine op — **off by default**. Pure `htable-config.ts` (validated/bounded entries, namespaced non-numeric keys, values from safe fields only, malformed set rejected whole before egress; deterministic idempotent `diffEntries` deleting stale MANAGED keys only — foreign keys untouched; defensive `parseDumpEntries`). `KamailioJsonRpcConnector.applyConfiguration` = dump→diff→bounded `htable.sets`/`htable.delete`→**re-dump verify** (OK only when matched; else APPLY_INCOMPLETE; TIMEOUT→PENDING_RECONCILIATION). `EngineConnector` contract += `applyConfiguration` (`NullEngineConnector`→NOT_IMPLEMENTED); `EngineConnectionManager.applyConfiguration` (SSRF guard); `EngineSyncService` routes apply through the connector boundary (ADR-0011) with `credentialId` threaded from the controller; `NOT_IMPLEMENTED→501` preserved for the Null default. Only the `telvyn` htable is named; mTLS cred revealed at boundary never logged; Redis mutex intact. No schema change. +17 unit tests (validation/diff/parse; connector cycle via fake htable transport incl. idempotency, foreign-key isolation, verify-mismatch, timeout, error, no-egress, secret hygiene) + opt-in live mutating test (`telecom-engine-apply-live.e2e.test.ts`, skipped). **Live mutation NOT executed** — Phase-5 gate (VPS `telvyn` htable via `loadmodule htable.so`+`modparam`, RUNBOOK; operator confirmation before first mutation). Production on `NullEngineConnector`. ADR-0013 Accepted + SECURITY.md + RUNBOOK.md + API.md. **Regression: API 291/291 (274 + 17), web 13/13, typecheck ✓, lint ✓** (2 opt-in live tests skipped). Next: operator sets up the htable + confirms → run the opt-in live apply. |
| 2026-11-17 | **Phase 12N-4b LIVE-VALIDATED — Phase 12N COMPLETE.** Operator declared the `telvyn` htable on the VPS (`loadmodule htable.so` + `modparam telvyn=>size=8`), verified it (empty dump `[]`; real non-empty dump shape `result:[{entry,size,slot:[{name,value,type}]}]` confirmed + pinned in a test, commit ba29e4f), and explicitly authorized the opt-in live apply. Ran it from the dev host over WireGuard+mTLS against the disposable Kamailio 6.1.5 engine: **before `[]` → reset (0/0) → apply desired (2 set, VERIFIED via re-dump: `did:+14155550123`=`<trunkId>`, `trunk:<id>`=`UDP`) → idempotent re-apply (0 set/0 del) → rollback-to-empty (2 del) → `[]`**. Formal opt-in test PASS (1/1). Only the `telvyn` htable touched; left clean. Added `scripts/live-apply-evidence.ts` (interleaves apply + raw dumps) + fixed a benign transport connect-listener accumulation (keep-alive socket reuse). **Production remains on `NullEngineConnector`** (`ENGINE_CONNECTOR` unset). ADR-0013 live-validated. Next: await owner direction. |
