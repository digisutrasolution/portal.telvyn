# CHANGELOG — Telvyn DID Portal PROMAX

All notable changes are documented here.
Format: Keep a Changelog; SemVer once releases begin.

## [Unreleased]

### Added
- 2026-08-26 — Project inception: documentation skeleton (`docs/`), ADR-0001
  (fully independent product/codebase).
- 2026-08-26 — Root `CLAUDE.md`: PROMAX Enterprise Engineering Constitution +
  Master Development Prompt.

### Changed
- 2026-08-26 — All docs revised to the EXISTING / PLANNED / PROPOSED / UNKNOWN
  status taxonomy, populated strictly from repository reality (docs-only,
  zero application code).
- 2026-08-26 — ARCHITECTURE.md expanded into the full 16-domain architecture
  audit (purpose/dependencies/IO/failure modes/scaling/security risks per
  component), grounded in the repository audit (docs-only, zero code).
- 2026-08-26 — DATABASE.md: production-grade database audit recorded — zero DB
  artifacts found (docs-only repo); findings register DB-001…DB-008 with
  severities + the 23-dimension acceptance checklist for the first schema.
- 2026-08-26 — SECURITY.md: defensive security audit recorded — secret/sensitive-
  data scan CLEAN; findings SEC-001…009 with severities; 30-area OWASP/telecom
  security baseline established as the per-feature contract.
- 2026-08-26 — UI_UX.md: UI/UX audit recorded — zero UI artifacts (nothing to
  inspect, zero inherited debt); PROMAX design mandate codified (NOC + fintech
  control plane + premium SaaS, anti-generic-dashboard rules); findings
  UX-001…006; 25-area acceptance contract established.
- 2026-08-26 — Design system v0.1 (PROPOSED): full token + component spec as
  final design rules in UI_UX.md; visual reference sheet with Light/Dark/System
  toggle at docs/design/telvyn-design-system.html (render-verified).
- 2026-08-26 — ROADMAP.md: owner-locked 20-phase master build program (Shell →
  … → DevOps) with gate decisions, dependency spine, and cross-cutting rules.
- 2026-08-26 — Design system v0.1 APPROVED by owner — UX-002 gate closed; the
  spec in UI_UX.md is now binding for all UI work.

### Phase 1 (frontend shell) — SHIPPED 2026-08-26
- Application shell: pnpm monorepo scaffold, git initialized (commit 2b18890),
  Next.js 15 + React 19 + Tailwind v4 + token-skinned Radix/cmdk component
  layer per ADR-0002; sidebar, topbar, breadcrumbs, global search, Ctrl+K
  palette (E.164-aware), notifications, user menu, tenant + region selectors,
  health indicator, theme selector, mobile sheet nav; honest phase-gated
  module pages; 13 tests + typecheck + build green; runtime-verified.

### Phase 2 (authentication foundation) — IMPLEMENTED 2026-08-27
- ADR-0003 backend stack (NestJS 11 + Prisma 6 + PostgreSQL 18 + Redis 7).
- Contract-first `packages/contracts/openapi/telvyn.v1.yaml`.
- `apps/api`: login/logout/logout-all, JWT access + rotating refresh w/ reuse
  detection, session & device management + immediate revocation, TOTP MFA +
  recovery codes + step-up disable, password reset + email verification via
  EmailOutbox seam, Redis fail-closed rate limiting + progressive brute-force
  lockout, argon2id, SecurityEvent/LoginAttempt audit + owner-visible history,
  RFC 7807 errors, httpOnly SameSite=Strict refresh cookie.
- `docker-compose.dev.yml` (PG18 + Redis), `.env.example`, create-operator CLI.
- Tests: 7 unit (crypto, lockout) green; 13-scenario e2e suite authored
  (requires the dev data plane; not executed in the build environment).
- No migration required: the prior null-session shell seam was designed for
  this wiring — backward-compatible by construction.

### Phases 3+4 (tenancy + RBAC authorization foundation) — IMPLEMENTED 2026-08-27
- ADR-0004: tenant isolation = server-derived context + mandatory data-layer
  scoping (Prisma extension, deny-by-default) + PostgreSQL RLS defense-in-depth.
  Resolves the CRITICAL gate DB-002/SEC-001.
- Models: Tenant, Membership, Role, Permission, PermissionGroup, RolePermission,
  MembershipRole, AuditLog; Session.tenantId + access-token `tid` claim.
- RBAC: seeded permission catalog + groups, system roles (owner/admin/operator/
  auditor), tenant custom roles, wildcard grants, deny-by-default route guards.
- Endpoints (v1): tenant get/update, members, member roles, roles list/create/
  delete, permission catalog, audit-logs — triple-gated (auth → tenant → perm).
- Audit log on every authz mutation; owner-visible audit endpoint.
- Tests: 19 new unit (authorization, tenant-scope, catalog) = 26 API unit total;
  authz e2e suite (cross-tenant, IDOR, privilege escalation, unauthorized
  access, client-tenant-id-ignored, audit) authored — run against the seeded
  data plane per RUNBOOK.md (not executed in the build environment).
- Seed script, create-tenant CLI, RLS enablement SQL.

### Audit
- 2026-08-29 — **Phase 1–11 completion audit** (independent verification).
  Backend auth+tenancy+RBAC (roadmap Phases 2–4) verified real and well-built;
  26 unit tests PASS + typecheck clean (both apps). 22 integration/e2e tests
  NOT EXECUTABLE this session — local Postgres/Redis data plane down (env, not
  code); previously green 48/48. Key gaps: Phase-5 auth FRONTEND not implemented
  (static shell, no backend calls — honest null-session seam, no fake auth); no
  CI/CD (SEC-003 still open); no HTTP security headers (helmet/CSP/HSTS); RLS
  written but not operative (app-layer scoping is active + tested). No P0/P1
  security or data-integrity defects found. Verdict: NOT READY for next phase
  until e2e re-run green + CI + security headers land. Full report in session.

### Security
- 2026-08-29 — **Pre-Phase-12 security hardening.** API: `helmet` tuned for a
  JSON API (`default-src 'none'`, DENY frames, no-referrer, CORP same-site,
  Permissions-Policy; HSTS prod-only) + 3 header regression tests. Web:
  nonce-based CSP (production-only) via `middleware.ts` — `script-src` nonce +
  `strict-dynamic`, no `unsafe-eval`/script-`unsafe-inline` (style-`unsafe-inline`
  documented-necessary for Radix); `next.config.ts` gains Permissions-Policy +
  prod-only HSTS; nonce threaded to `next-themes`. Verified against the running
  production build (11/11 scripts nonced, theme script executed, hydrated, zero
  CSP violations). RLS: **deferred** with a staged plan (ADR-0005) — app-layer
  scoping remains the tested control. Auth frontend: documented INCOMPLETE (next
  phase). Regression: API 51/51 (48 baseline + 3 header), web 13/13, typecheck +
  lint clean, web prod build green. No security control weakened.

### Phase 12
- 2026-08-29 — **Phase 12A — Telecom control-plane architecture + domain
  boundaries** (documentation only; no schema, no code). ADRs added: 0006
  (control plane vs data plane), 0007 (provider-neutral engine abstraction +
  honest NOT-IMPLEMENTED adapters), 0008 (carrier platform/wholesale vs tenant
  + system-or-tenant read mode), 0009 (TelecomCredential vault — secrets
  separated from config, never exposed/logged/audited, external-manager
  compatible), 0010 (node config vs runtime + provider-neutral health model,
  no fabricated health). TELECOM.md expanded with the 15 domain boundaries and
  the table-vs-deferred split (Endpoint/CodecPolicy/NumberingPlan/FailoverPolicy
  = fields; Registration/CallSession = non-persisted runtime). No application
  code changed; baseline intact.
- 2026-08-29 — **Phase 12B — Database foundation.** Additive migration
  `telecom_foundation` (15 enums, 14 tables, 27 indexes, 20 FKs; no destructive
  ops, no changes to existing tables — reviewed via `--create-only` before
  apply). RBAC catalog extended: +14 permissions (telecom/carrier/sip_trunk/
  routing/did.manage) in a new `telecom` group; admin/operator/auditor grants
  updated (owner `*` auto-covers; platform `telecom.manage` stays owner-only).
  Seed re-synced idempotently (26 permissions, 4 roles). Regression: API 51/51,
  typecheck ✓, lint ✓. No application services yet (12C onward).
- 2026-08-29 — **Phase 12C — Telecom engine abstraction.** Provider-neutral
  `TelecomEngineAdapter` interface + `EngineRegistryService` + honest
  NOT-IMPLEMENTED `Kamailio`/`Asterisk`/`FreeSwitch` adapters (ADR-0007):
  `implemented=false`, `healthCheck()`→UNKNOWN (never fabricated HEALTHY),
  static capability profiles (honest software facts, e.g. Kamailio declares no
  RTP). `TelecomModule` wired into AppModule (providers only, no controllers/DB
  yet). +7 unit tests. Regression: API 58/58 (51 + 7), typecheck ✓, lint ✓.
- 2026-08-29 — **Phase 12D — Region + Node model (platform telecom infra).**
  Services + `/v1/telecom/{regions,engines,nodes}` CRUD (+ engine capabilities,
  node health read). New `PlatformGuard` (+`tenantType` on TenantContext, loaded
  by TenantGuard) restricts platform infra to PLATFORM-tenant members — a
  customer owner with `*` is refused. Zod validation, referential checks,
  audited mutations, honest health (UNKNOWN) + honest adapter metadata. +4 e2e
  (platform-scope, permission gating, CRUD/integrity/health, audit). Regression:
  API 62/62 (58 + 4), typecheck ✓, lint ✓. No schema changes (uses 12B tables).
- 2026-08-29 — **Phase 12E — Carrier foundation.** `/v1/telecom/carriers` CRUD
  on the 12B tables (no schema change). Dual-nature scope (ADR-0008) via new
  `systemOrTenantWhere`/`authorizeDualNatureWrite`/`ownerTenantIdForCreate`
  helpers (unit-tested); `TelecomCredentialService` vault (ADR-0009) — secrets
  encrypted at rest, never selected/returned/logged/audited, decrypt only at the
  adapter boundary. Cursor pagination + filters (status/region/scope/q). RBAC
  reuses 12B `carrier.*`. +11 tests (8 carrier e2e: isolation/IDOR/system-scope/
  credential-secrecy/validation/pagination + 3 scope-helper units). Regression:
  API 73/73 (62 + 11), web 13/13, typecheck ✓, lint ✓. No migration.
- 2026-08-29 — **Phase 12F — SIP trunk foundation** (control-plane config only,
  no live connectivity). Additive migration `sip_trunk_carrier_link`
  (`SipTrunk.carrierId` FK + index; reviewed --create-only, table empty). New
  `/v1/telecom/sip-trunks` CRUD; SipTrunk added to `TENANT_SCOPED_MODELS`
  (auto-scoped, IDOR-safe). Carrier-accessibility + credential ownership/type
  (SIP_PASSWORD) checks; secrets vault-only, never exposed. SSRF/CRLF-hardened
  host/URI validation; no outbound connections. RBAC reuses 12B `sip_trunk.*`.
  +11 tests (9 e2e + 2 scope). Regression: API 84/84 (73 + 11), web 13/13,
  typecheck ✓, lint ✓, build ✓.
- 2026-08-29 — **Phase 12G — DID foundation** (control-plane resource only; no
  telecom runtime). Additive migration `did_sip_trunk_link` (`Did.sipTrunkId` FK
  + filter indexes; reviewed --create-only). `/v1/telecom/dids` CRUD; Did added
  to `TENANT_SCOPED_MODELS` (auto-scoped, IDOR-safe). E.164 normalization via
  `libphonenumber-js` (canonical store, derived country); GLOBAL `@unique` on
  e164 (duplicate → 409; partial-unique recycle deferred). Relationship auth
  (carrier/trunk/routing-profile/region) + carrier↔trunk consistency; soft
  delete + SET NULL relations. RBAC reuses did.read/did.manage. +11 tests (8 e2e
  + 3 E.164 unit). Regression: API 95/95 (84 + 11), web 13/13, typecheck ✓,
  lint ✓, build ✓. (Env note: pgsql cluster had lost seed data mid-session —
  re-seeded to restore 26 perms; verify seed after any cluster restart.)
- 2026-08-29 — **Phase 12H — Routing profile foundation** (declarative config
  only; no runtime execution). Additive migration `routing_rule_config`
  (RoutingDestinationType enum + RoutingRule destinationType/timeout/retry/
  schedule; reviewed --create-only). `/v1/telecom/routing-profiles` CRUD with
  embedded rules; RoutingProfile joined `TENANT_SCOPED_MODELS`. Typed
  destinations w/ per-type validation (SSRF-safe webhooks — never called),
  deterministic priority ordering, bounded retry/timeout, IANA-validated
  schedule. RBAC reuses routing.read/routing.manage. +13 tests (10 e2e + 3
  e164). Regression: API 105/105 (95 + 10), web 13/13, typecheck ✓, lint ✓,
  build ✓.
- 2026-08-29 — **Phase 12I — Routing policy + failover foundation** (declarative
  config only; no runtime). Additive migration `routing_policy_failover`
  (RoutingSelectionStrategy + RoutingFailoverCondition enums; RoutingProfile
  policy fields incl. `version`; RoutingRule `weight` + `failoverDestinationType`
  — no new FailoverPolicy table). Extends 12H profile API with policy semantics,
  declarative failover conditions, typed failover, loop protection (self-failover
  rejected + bounded maxAttempts), and **atomic optimistic-concurrency updates**
  (`expectedVersion` → 409). +6 e2e. Regression: API 111/111 (105 + 6), web
  13/13, typecheck ✓, lint ✓, build ✓.
- 2026-08-29 — **Phase 12J — Routing decision + LCR policy foundation**
  (declarative route selection only; no execution, rating, or billing). Additive
  migration `lcr_policy` (enums Currency + LcrSelectionStrategy; tables LcrPolicy
  + LcrRoute with BigInt `costMicros` micro-units). `/v1/telecom/lcr-policies`
  CRUD (embedded route candidates). Deterministic candidate ordering per strategy
  (pure `orderCandidates`, stable id tie-break); carrier/trunk eligibility;
  bounded cost/currency/prefix/effective-date validation; atomic optimistic-
  concurrency updates. RBAC reuses routing.read/routing.manage (no new perms).
  +13 tests (8 e2e + 5 ordering unit). Regression: API 124/124 (111 + 13), web
  13/13, typecheck ✓, lint ✓, build ✓.
- 2026-09-01 — **Phase 12K — Telecom engine foundation + engine abstraction**
  (control-plane abstraction only; NO SIP/RTP/engine runtime). **No migration** —
  reuses the 12C/12D adapter interface, `EngineRegistryService`, and the existing
  engine/node/health models. New provider-neutral `engine.types.ts` (capabilities,
  health, context, normalized `EngineErrorCode`/`EngineError`, operation result,
  secret-free `EngineConfigurationIntent`); adapters gained explicit
  `capabilities()` (Kamailio `originate:false`; Asterisk/FreeSWITCH `originate:true`)
  and honest `applyConfiguration()` → `NOT_IMPLEMENTED`. New `EngineService`
  (bounded-timeout guard, correlation IDs, structured secret-free logging, error
  normalization, pure `buildConfigurationIntent` that reduces credentials to id
  refs). Platform-only endpoints `GET /v1/telecom/engines/:id/status` (honest
  UNKNOWN health + explicit capabilities) and `POST /v1/telecom/engines/:id/sync`
  (→ HTTP 501 NOT_IMPLEMENTED, audited `telecom.engine.sync_attempted`). RBAC
  reuses telecom.health.read/telecom.manage (no new perms). +10 tests (6 unit +
  4 e2e). Regression: API 134/134 (124 + 10), web 13/13, typecheck ✓, lint ✓,
  build ✓. Realizes the growth path in ADR-0007 (addendum added).
- 2026-09-01 — **Phase 12L — Engine runtime integration foundation** (secure seams
  only; NO live SIP/RTP/engine runtime, **no network egress** — discovery confirmed
  no real engine exists). **No migration** — reuses `TelecomConfigVersion` (versioning)
  and `HealthEvent` (transitions). New `engines/runtime/`: **canonical SSRF egress
  policy** `engine-endpoint.ts` (http(s)+public-host only; blocks loopback/RFC1918/
  CGNAT/link-local+metadata/ULA/multicast/IPv4-mapped+NAT64 IPv6/alt-representations;
  DNS-rebinding recheck) — active gate on engine-endpoint config (→400) and pre-connect;
  `connection-profiles.ts` (typed per-provider mechanism + bounded timeout/retry/backoff);
  `EngineConnector`+**`NullEngineConnector`** (honest UNKNOWN, zero egress — the only
  wired connector); `EngineConnectionManager` (normalized reachability, BLOCKED refused
  pre-connect); `EngineHealthService` (honest health, HealthEvent on transition);
  `EngineSyncService` (deterministic secret-free config **fingerprint** = desired
  version, append-only `TelecomConfigVersion` history, **idempotent**, stale-downgrade-safe
  **rollback**, fail-closed Redis `SET NX` **concurrency lock**; apply → honest
  NOT_IMPLEMENTED, appliedVersion stays null). Platform-only endpoints: richer
  `GET :id/status` (+connection/version), `POST :id/health-check`, versioned
  `POST :id/sync` (concurrent→409, lock-outage→503), `POST :id/sync/rollback`
  (no-previous→400). RBAC reuses telecom.health.read/telecom.manage (no new perms).
  New ADR-0011 (engine runtime integration boundary). +56 tests (49 unit + 7 e2e).
  Regression: API 190/190 (134 + 56), web 13/13, typecheck ✓, lint ✓, build ✓.
- 2026-10-15 — **Phase 12M-A — Engine sync mutex fail-closed coverage** (test-only;
  no production change). Added `engine-lock.service.test.ts` (+6 unit, fake Redis):
  own-token compare-and-delete release, TTL floor ≥1000ms, `EngineLockBusy` on
  contention, **fail-closed `EngineLockUnavailable` on Redis outage**, release-on-throw.
  Verdict READY-FOR-INFRASTRUCTURE (real-engine gate unmet — `NullEngineConnector`
  still the only connector). Regression: API 196/196 (190 + 6), web 13/13.
- 2026-11-16 — **Phase 12M-1 — Engine credential reference (additive schema).** First
  sub-phase of the real Kamailio adapter: the schema foundation an engine needs to
  reference its management-plane secret in the vault. Additive migration
  `engine_credential_ref` (reviewed `--create-only`, **zero destructive ops**):
  `TelecomCredentialType.ENGINE_API`; `TelecomEngine.credentialId` (nullable FK →
  `TelecomCredential`, `ON DELETE SET NULL`) + index; `TelecomCredential.engines`
  back-relation. A reference only — secrets stay vault-encrypted, decrypted solely at
  the adapter boundary. **No behavior/DI/egress change**; applied-version state remains
  the append-only snapshot model (no column) per ADR-0011. ADR-0011 addendum records
  the decision. +3 integration tests (ENGINE_API usable, engine↔credential link,
  SET NULL on credential delete). Regression: **API 199/199 (196 + 3)**, web 13/13,
  typecheck ✓, lint ✓.
- 2026-11-17 — **Phase 12M-2 — Engine management private-network SSRF allowlist.**
  Extends the canonical egress policy (`engine-endpoint.ts`) so a real engine can
  be reached over a PRIVATE transport (WireGuard + mTLS gateway) while RFC1918 stays
  denied by default. A narrow, explicit allowlist (platform env `ENGINE_MGMT_ALLOWLIST`,
  `CIDR@port[;port…]`) authorizes a **specific IP + port individually**: IPv4 `/24..32`
  (blanket `10/8`·`172.16/12`·`192.168/16` rejected), IPv6 exact `/128`, port mandatory,
  matched on the **IP address only** (a hostname can never be allowlisted → rebinding
  defeated); enforced at config time **and** the connect-time `assertResolvedIpAllowed`
  recheck. Malformed entries dropped (fail-closed); **unset = the prior strict
  public-only policy, unchanged**. No egress yet (`NullEngineConnector` still wired);
  no schema/DI change. +37 unit tests (token parsing, exact IP+port match, parse +
  connect-time integration, every other guard still holds, env memoization). ADR-0011
  addendum + SECURITY.md updated; `.env.example` documents the var. Regression: **API
  236/236 (199 + 37)**, web 13/13, typecheck ✓, lint ✓, build ✓.
- 2026-11-17 — **Phase 12M-3 — real Kamailio management connector (read-only health).**
  First real engine connector: a JSONRPC `core.version` **health probe** over the
  private mTLS gateway, **off by default**. New `KamailioJsonRpcConnector` (honest
  health: valid version → HEALTHY, answered-but-not-OK → UNHEALTHY, unreachable →
  UNKNOWN; transport failures mapped to a safe fixed vocabulary — no raw provider/TLS
  text), one injectable network seam `EngineHttpTransport` + real `NodeHttpsEngineTransport`
  (https+mTLS, server-cert verified, **connect-time rebinding recheck** via the 12M-2
  allowlist, bounded timeouts, capped body), and an **env-gated DI factory**
  (`ENGINE_CONNECTOR=kamailio` engages it; unset/other → `NullEngineConnector`). The mTLS
  client cert is a vault `ENGINE_API` credential, decrypted only at the boundary
  (`revealForAdapter`), never cached/logged/returned (test-proven the key never leaks
  into a detail). `credentialId` threaded engine→health→connection→probe; engine view
  now surfaces the non-secret `credentialId`. **No migration; default behavior
  unchanged** (NullEngineConnector still wired with the flag off → all existing e2e
  pass). Applied-version/`PENDING_RECONCILIATION` persistence intentionally deferred
  (only meaningful once `applyConfiguration` does real network work — no engine↔resource
  model yet). +19 unit tests (connector logic, env-gated selection, transport https guard;
  live network path integration-tested in 12M-4). ADR-0011 addendum + SECURITY.md +
  `.env.example` updated. Regression: **API 255/255 (236 + 19)**, web 13/13, typecheck ✓,
  lint ✓, build ✓.
- 2026-11-17 — **Phase 12M-4 — live Kamailio engine integration PROVEN.** The real
  `KamailioJsonRpcConnector` validated end-to-end against a disposable Kamailio 6.1.5
  test engine — no mocks: vault decrypt → `NodeHttpsEngineTransport` (mTLS + connect-time
  rebinding recheck) → nginx mTLS gateway (`wg0:8443`) over WireGuard → Kamailio JSONRPC
  `core.version` → **HEALTHY** (`reachable — kamailio 6.1.5 (x86_64/Linux)`, ~750ms).
  Management plane is PRIVATE (WireGuard + mTLS, SIP/RTP closed). New committed artifacts:
  `scripts/probe-live-engine.ts` (ops proof) and `test/telecom-engine-live.e2e.test.ts`
  (**opt-in** — skipped unless `ENGINE_LIVE_MTLS_DIR` is set, so CI/normal runs are
  unaffected). RUNBOOK.md documents the full VPS + control-plane procedure with real
  paths and the gotchas (wg-quick dropping the wg0 Address, stale-apt 404 from a hung
  lock, MITM-antivirus TLS interception on the dev host, Windows schannel vs PEM certs).
  No production-code change (the connector/transport shipped in 12M-3). Regression: **API
  255/255 + 1 opt-in live PASS, 1 skipped by default**, web 13/13, typecheck ✓, lint ✓.
  **Phase 12M COMPLETE** — real engine adapter delivered, review-gated, honest, live-proven.
- 2026-11-17 — **Phase 12N-1 — engine↔resource assignment model (additive schema).** First
  sub-phase of making an engine's desired config non-empty. Additive migration
  `engine_resource_assignment` (ADR-0012, reviewed, no existing table changed): `enum
  EngineResourceKind` (SIP_TRUNK/DID/ROUTING_PROFILE) + `EngineResourceAssignment` table —
  `engineId` FK (Cascade), denormalized `tenantId` FK (Cascade; null = platform), and three
  explicit nullable resource FKs (`sipTrunkId`/`didId`/`routingProfileId`, each Cascade) —
  real FKs, never a polymorphic id. A **DB CHECK** enforces exactly-one-resource-matching-kind;
  per-kind `@@unique([engineId, <resourceId>])` bars double assignment; `enabled` + soft delete.
  Platform-managed (API in 12N-2). No service/API/behavior change. +4 integration tests
  (assign each kind, unique, CHECK rejects zero/two/mismatch, cascades). ADR-0012 +
  DATABASE.md. Regression: **API 259/259 (255 + 4), web 13/13, typecheck ✓, lint ✓.**
- 2026-11-17 — **Phase 12N-2 — engine resource assignment service + platform API.**
  `EngineAssignmentsService` + `EngineAssignmentsController` under
  `/v1/telecom/engines/:engineId/assignments` (PlatformGuard). `POST {kind, resourceId}`
  validates the resource against the table implied by `kind` (missing → 404) and derives
  `tenantId` from the resource's owner — **never client-supplied**; a resource already
  assigned → **409**; re-assigning a previously-unassigned resource **reactivates** it
  (no unique conflict, soft-delete preserved). `GET` lists active assignments with a
  non-secret resource label; `PATCH :id {enabled}` toggles; `DELETE :id` soft-unassigns
  (204). RBAC reuses `telecom.read`/`telecom.manage`; every mutation audited
  (`telecom.engine.resource_{assigned,assignment_updated,unassigned}`). No schema change;
  no config pushed (assignments feed the desired intent in 12N-3). +7 e2e (assign/list,
  409 double-assign, 404 missing resource, DID+profile, enable→unassign→reactivate,
  customer 403 + unauth 401). API.md + CHANGELOG. Regression: **API 266/266 (259 + 7),
  web 13/13, typecheck ✓, lint ✓.**
- 2026-11-17 — **Phase 12N-3 — desired config intent from assignments.** `EngineSyncService`
  now builds the engine's desired `EngineConfigurationIntent` from its **enabled, non-deleted
  assignments** (via new `EngineAssignmentsService.buildConfigurationSource`) instead of an
  empty source — so the config **fingerprint is now meaningful**. Secret-free: trunks/DIDs/
  routing-profile-rules map to the intent; carriers are derived from the assigned trunks'/DIDs'
  carriers (priority 0 — no per-engine carrier ordering yet); soft-deleted/disabled resources
  are excluded; deterministic order. `GET :id/status` gains a live `desired` preview
  (`{version, summary{carriers,trunks,dids,routes}}`); `POST :id/sync` records the non-empty
  desired version. **No config is pushed** (connector still honest `NOT_IMPLEMENTED` until
  12N-4). No schema change. +3 e2e (empty→populated→disabled, counts + fingerprint change);
  sync-service unit test updated for the new dependency. API.md updated. Regression: **API
  269/269 (266 + 3), web 13/13, typecheck ✓, lint ✓.**
- 2026-11-17 — **Phase 12N-4a — applied-version persistence + reconciliation state machine**
  (no engine mutation). Implements the applied-version route ADR-0011 deferred. Pure
  `decideApplyOutcome` state machine: success → **APPLIED** (append an `applied` snapshot,
  advance the applied version); **TIMEOUT → PENDING_RECONCILIATION** (append a
  `reconcile_pending` snapshot; engine state UNKNOWN, applied **never** advanced); any other
  failure → **FAILED** (no snapshot, retryable). Wired into `EngineSyncService.sync`/`rollback`
  via `recordApplyOutcome`; `posture()` + `GET :id/status.version` + `POST :id/sync` surface
  `syncState`; sync audit metadata gains it. Append-only snapshot route — **no migration**.
  With the adapter still a stub, every real apply is `NOT_IMPLEMENTED → FAILED` (applied stays
  `null` — honest); the machinery is complete + tested for a real apply. **ADR-0013 (Proposed)**
  records the real Kamailio apply mechanism (htable-via-RPC) for 12N-4b — it mutates a live
  engine and needs owner approval + a one-line VPS `kamailio.cfg` addition. +5 unit tests
  (decideApplyOutcome branches; APPLIED/PENDING_RECONCILIATION/FAILED sync paths; posture
  lifecycle). ADR-0011 addendum + API.md. Regression: **API 274/274 (269 + 5), web 13/13,
  typecheck ✓, lint ✓.**
- 2026-11-17 — **Phase 12N-4b — real Kamailio htable config apply (ADR-0013 Accepted).**
  The first operation that changes engine state — **off by default, live mutation
  operator-gated**. Pure `htable-config.ts`: validated/bounded desired entries
  (namespaced non-numeric keys; values from safe fields only; a malformed set rejected
  whole before any egress), deterministic idempotent `diffEntries` (deletes stale
  **managed** keys only — foreign keys untouched), defensive `parseDumpEntries`.
  `KamailioJsonRpcConnector.applyConfiguration` = dump → diff → bounded
  `htable.sets`/`htable.delete` → **re-dump verify** (OK only when it matches; else
  `APPLY_INCOMPLETE`; TIMEOUT → PENDING_RECONCILIATION). Added `applyConfiguration` to the
  `EngineConnector` contract (`NullEngineConnector` → honest NOT_IMPLEMENTED) +
  `EngineConnectionManager.applyConfiguration` (SSRF guard); `EngineSyncService` now routes
  apply through the connector boundary (ADR-0011) with `credentialId` threaded from the
  controller. Only the `telvyn` htable is ever named; mTLS cred revealed at the boundary,
  never logged; concurrency still Redis-mutex-guarded; `NOT_IMPLEMENTED → 501` preserved for
  the Null default. No schema change. +17 unit tests (validation/diff/parse; connector
  dump→diff→apply→verify via a fake htable transport — happy path, idempotency, stale-delete +
  foreign isolation, verify-mismatch, timeout, JSONRPC error, no-egress, secret hygiene) +
  **opt-in** live mutating test (`telecom-engine-apply-live.e2e.test.ts`, skipped unless
  `ENGINE_LIVE_MTLS_DIR`). ADR-0013 Accepted + SECURITY.md + RUNBOOK.md + API.md. **Live
  mutation NOT executed** (Phase-5 gate: needs the VPS `telvyn` htable + operator confirmation).
  Production remains on `NullEngineConnector`. Regression: **API 291/291 (274 + 17), web 13/13,
  typecheck ✓, lint ✓** (1 opt-in apply + 1 opt-in health skipped).
- 2026-11-17 — **Phase 12N-4b LIVE-VALIDATED (operator-authorized) — Phase 12N COMPLETE.** With
  the `telvyn` htable declared on the disposable VPS and the real dump shape confirmed (pinned
  in a test, `ba29e4f`), ran the opt-in live apply over WireGuard+mTLS against Kamailio 6.1.5:
  before `[]` → reset (0/0) → apply desired (2 set, **verified by re-dump**) → **idempotent
  re-apply (0 set/0 del)** → **rollback-to-empty (2 del)** → `[]`. Formal opt-in test PASS (1/1);
  only the `telvyn` htable touched, left clean. Added `scripts/live-apply-evidence.ts`; fixed a
  benign transport connect-listener accumulation under keep-alive socket reuse. **Production
  remains on `NullEngineConnector`.** ADR-0013 live-validated.
- 2026-11-18 — **Phase 12O-2a — authorization context endpoint (`GET /v1/me/context`).**
  Read-only, self-scoped "whoami" for the authenticated session: returns
  `{ userId, tenantId, tenantType, roles[], permissions[] }` from the server-derived
  tenant context (ADR-0004). No `@RequirePermissions` (the frontend calls it at bootstrap,
  before it knows any permissions); JwtAuthGuard + TenantGuard still require a live, active
  membership, and no client-supplied tenant id is read (no IDOR). `permissions` are the
  **expanded concrete** keys (owner's `*` resolved), sorted. Additive only — no schema,
  migration, DI-default, or API-auth-behavior change. New `TenancyService.memberContext`,
  one route on `AuthzController`, `MeContext` in the OpenAPI contract, 4 e2e cases in
  `authz.e2e.test.ts` (401, owner shape, operator-read-not-manage, no cross-tenant leak).
  ADR-0014 Accepted. This is the first backend prerequisite for the NOC auth frontend
  (Phase 12O-2b+).
- 2026-11-18 — **Phase 12O-2b — frontend API client + session foundation.** The web
  app's first data layer (client + session only — NO UI, NO CSP change, not yet mounted
  into the shell). Contract-first per ADR-0002: added `openapi-typescript` (web devDep) +
  a `gen:contracts` script that regenerates `apps/web/src/lib/contracts/schema.ts` from the
  canonical `telvyn.v1.yaml`; the generated file is committed and never hand-edited.
  Modules: `lib/api/client.ts` (centralized typed `fetch` — bearer attach, `credentials:
  include` for the later refresh cookie, per-request timeout + caller cancellation on one
  AbortSignal, non-2xx → typed `ApiError` carrying the RFC 7807 `problem+json`, **no auto-
  retry**); `lib/api/token-store.ts` (in-memory access token only — never localStorage, XSS
  defense); `lib/api/problem.ts` (`ApiError`/`isApiError`); `lib/session/session-context.tsx`
  (`SessionProvider` + `useSession` loading `GET /v1/me/context`, exposing `status` /
  `isPlatform` / `hasPermission`-family / `reload`, loader injectable for tests). Permission
  helpers are **UX-only**; server guards remain authoritative. +20 unit tests (web 13 → 33),
  typecheck ✓, lint ✓. ADR-0015 Accepted. `next build` deferred to the mount slice (modules
  not yet imported by any route). Next: **12O-2c** — mount the provider, login/MFA pages,
  permission-aware nav, and the CSP `connect-src` += API origin.
- 2026-11-18 — **Phase 12O-2c — auth frontend: sign-in gate + login/MFA flow.** Mounts the session
  layer and makes the app require authentication. New `<AuthBoundary>` gates the shell on session
  status (authenticated → app; unauthenticated → sign-in screen; forbidden → no-workspace notice;
  error → retry; loading). `ThemeProvider`/`TooltipProvider` hoisted from `AppShell` into a new
  `<AppProviders>` so the sign-in screen and shell share theming. `LoginScreen`: email+password →
  `/v1/auth/login`, MFA code step → `/v1/auth/mfa/verify`; on success the access token enters the
  in-memory store and the session reloads. `SessionProvider` gains **refresh-on-bootstrap**
  (`/v1/auth/refresh` via the httpOnly cookie restores the session on reload — the token is never
  stored) and `signOut` (`/v1/auth/logout` + clear + unauthenticated), wired into the account menu.
  CSP `connect-src` now includes the API origin (derived from `NEXT_PUBLIC_API_URL`; unset/same-origin
  → `'self'`). First form primitives added: `Input`/`Label`/`Field` (v0.1 tokens). `distDir` made
  env-overridable (`NEXT_DIST_DIR`) so a build can run beside a live dev server. **No backend/API/
  schema/DI change** — server authn/z stays the authority; the gate is UX only. web 33 → 53 tests,
  typecheck ✓, lint ✓, `next build` ✓; live browser check shows the gate render + graceful API-down
  state with no console errors. ADR-0016 Accepted. Deferred: password-reset/email-verify pages,
  permission-aware nav + route gating, MFA enroll/manage (12O-2d+).
- 2026-11-18 — **Phase 12O-2d — password reset + email verification flows.** Public, token-bearing
  screens against the existing `/v1/auth/*` endpoints (contract already covered them — no contract
  change). New public routes `/reset-password` and `/verify-email` render themed but **bare** (no
  session provider, no gate, no shell): the decision moves to `<AppProviders>` via a tested
  `isPublicAuthPath(usePathname())` helper. `ResetPasswordScreen` (no token → request email, always
  202/non-enumerating; with token → set new password, client-validates ≥12 + match → confirm,
  server revokes all sessions), reached from a new "Forgot password?" link on the sign-in screen.
  `VerifyEmailScreen` confirms the token on mount (StrictMode-guarded) → success/failure. Four new
  `auth-actions` (request/confirm reset, request[authed]/confirm verify). Shared `AuthCard` +
  `messageFor` extracted and adopted by the sign-in screen too. The authed email-verification
  *resend* action exists but its in-app trigger is deferred (needs `emailVerified`, absent from
  `/v1/me/context`). `.next-build/` added to eslint ignores (a stray isolated build dir no longer
  pollutes `eslint .`). **No backend/API/schema/DI change.** web 53 → 69 tests, typecheck ✓, lint ✓,
  `next build` ✓ (both routes); routes render-verified bare in the browser. ADR-0016 addendum.
  Deferred: permission-aware nav + route gating, MFA enroll/manage, the email-unverified banner.
- 2026-11-18 — **Phase 12O-2e — permission-aware navigation + route gating.** The shell now reflects
  what a member can access. `NavItem` gains a `permission` key (real catalog keys): Numbers/Porting →
  `did.read`, Billing/CDRs → `wallet.read` (CDRs provisional — no `cdr.read` key exists yet), Admin →
  `member.read`, Operations landing unguarded. A `useVisibleNavItems()` hook filters the sidebar,
  mobile sheet, and command palette from one source (no drift). A central `<RouteGuard>` wraps the
  shell `<main>` and renders the page only when the session holds the route's permission
  (`requiredPermissionForPath`), else an honest "Access restricted" state — no per-page boilerplate.
  **UX gating only** — every API route keeps its own server-side authz, so a hand-typed URL reveals
  nothing. +8 unit tests (web 69 → 77; `requiredPermissionForPath` mapping, NavList show/hide,
  RouteGuard allow/deny/unguarded). **No backend/API/schema/DI change.** typecheck ✓, lint ✓,
  `next build` ✓. ADR-0017 Accepted. Deferred: read-only NOC pages, MFA enroll/manage,
  email-unverified banner, a `cdr.read` permission.
- 2026-11-18 — **Phase 12O-2f — NOC: read-only Engines overview + telecom read contract.** The first
  NOC (telecom control-plane) screen. **Contract-first:** authored `GET /v1/telecom/engines` + the
  `Engine`/`EngineHealth`/`EngineCapabilities` schemas into `telvyn.v1.yaml` from the real
  `EnginesService.view` shape (real enum values; begins closing the "OpenAPI covers /v1/auth only"
  debt), regenerated types. New thin `useResource(fetcher)` hook (native fetch via the client; load on
  mount + `reload()`; abort on unmount; RFC 7807 title on error — no react-query). `listEngines()`
  typed action. `<EnginesView>` renders a read-only table (name/type/environment/status/health
  badges/version) with honest loading/empty/error states; **health is `UNKNOWN` for stub adapters,
  never fabricated.** Platform-aware nav: `NavItem` gains a `platform` flag; `useVisibleNavItems` and
  `RouteGuard` now require the platform tenant for such items on top of the permission. New
  "Infrastructure" nav item + `/infrastructure` route (`platform: true` + `telecom.read`) — invisible/
  blocked for non-platform members, matching the API's PlatformGuard. **Read-only, UX-gated; the API
  re-checks telecom.read + platform.** +14 unit tests (web 77 → 91). **No backend/API/schema/DI
  change** (the endpoint already existed). typecheck ✓, lint ✓, `next build` ✓ (route present). ADR-0018
  Accepted. Deferred: engine detail + live `/status`, nodes/regions, MFA enroll/manage, `cdr.read`.
- 2026-11-18 — **Phase 12O-2g — NOC engine detail + live status.** Read-only engine detail screen.
  **Contract-first:** authored `GET /v1/telecom/engines/{id}` (→ `Engine`) and `/{id}/status`
  (→ new `EngineStatus` + `EngineConnection`/`EngineVersionPosture`/`EngineDesiredPreview`) into
  `telvyn.v1.yaml` from the real `EnginesController.status` composition (connection state enum, sync
  state enum, desired-config counts), regenerated types. `getEngine`/`getEngineStatus` actions;
  `/infrastructure/[id]` route → `<EngineDetailView>` loads engine + status via two `useResource`
  calls and shows Health / Connectivity / Configuration-version / Desired-config cards; the engines
  table links each name to its detail. Honest UNKNOWN health / UNCONFIGURED connection with the Null
  connector — never fabricated. **Read-only** — health-check/sync POSTs (mutations) intentionally not
  wired. Route gated by the existing `/infrastructure` platform guard. +4 unit tests (web 91 → 95).
  **No backend/API/schema/DI change.** typecheck ✓, lint ✓, `next build` ✓ (both routes). ADR-0018
  addendum. Deferred: nodes/regions NOC views, mutating NOC actions, MFA enroll/manage, `cdr.read`.
- 2026-11-18 — **Phase 12O-2h — NOC nodes + regions + section sub-nav.** Rounds out the read-only NOC
  infrastructure section. **Contract-first:** authored `GET /v1/telecom/regions` (→ `Region`) and
  `GET /v1/telecom/nodes` (→ `Node` + `NodeHealth`) into `telvyn.v1.yaml` from the real service view
  shapes, regenerated types. `listRegions`/`listNodes` actions; `<RegionsView>` (code/name/country/
  timezone/status) and `<NodesView>` (name/environment/zone/status/heartbeat-health/version) read-only
  tables with honest loading/empty/error and UNKNOWN health. New `app/infrastructure/layout.tsx` adds a
  sub-nav (`<InfraTabs>`: Engines / Nodes / Regions) above every infrastructure page; nodes/regions are
  static sibling routes (`/infrastructure/nodes`, `/infrastructure/regions`), engines stays at
  `/infrastructure` with detail at `[id]`. All gated by the existing `/infrastructure` platform guard.
  +12 unit tests (web 95 → 107). **No backend/API/schema/DI change.** typecheck ✓, lint ✓, `next build`
  ✓ (all four /infrastructure routes). ADR-0018 addendum. Deferred: mutating NOC actions
  (health-check/sync), MFA enroll/manage, `cdr.read`.
- 2026-11-18 — **Phase 12O-2i — NOC mutating engine actions (health-check / sync / rollback).** The
  NOC's first write path. **Contract-first:** authored the three POST endpoints
  (`/v1/telecom/engines/{id}/health-check` → `EngineHealthReport`; `/{id}/sync` and `/{id}/sync/rollback`
  → `SyncOutcome`, with 409/501/503/504 problems) into `telvyn.v1.yaml` from the real controller/service
  shapes, regenerated types. New `<EngineActions>` panel on the engine detail page: **permission-gated**
  buttons (Check-health needs `telecom.health.read`; Sync/Rollback need `telecom.manage`), a **confirm
  dialog** before the state-changing sync/rollback, **no auto-retry** (the client never replays a
  mutation), and **honest results** — a successful `SyncOutcome` shown as `outcome — syncState`, the
  expected `501 NOT_IMPLEMENTED` (Null connector) shown in a neutral tone, 409/5xx/400 as warnings; each
  action refreshes the engine + status. The server (PlatformGuard + permission) re-checks every call —
  the gate is UX only. +8 unit tests (web 107 → 115). **No backend/API/schema/DI change** (endpoints
  already existed). typecheck ✓, lint ✓, `next build` ✓. ADR-0019 Accepted. Deferred: a type-to-confirm
  guard once a real connector is wired, MFA enroll/manage, email-unverified banner, `cdr.read`.
- 2026-11-18 — **Phase 12O-2j — email-unverified banner.** A quiet nudge in the authenticated shell
  when the signed-in user's email isn't verified, with a resend action. Reads identity from the
  already-contracted `GET /v1/auth/me` (new `getMe` action; `emailVerified` is not on `/v1/me/context`)
  and resends via the existing `requestEmailVerification`. `<EmailVerificationBanner>` renders nothing
  while loading, on error, or once verified; shows the email + "Resend email" (→ "Verification email
  sent") otherwise, and is dismissible for the session. Mounted below the topbar in `AppShell` (so it
  only shows for authenticated sessions). No contract change (endpoint already covered). +5 unit tests
  (web 115 → 120). **No backend/API/schema/DI change.** typecheck ✓, lint ✓, `next build` ✓. Deferred:
  MFA enroll/manage, a type-to-confirm guard for engine sync/rollback, a `cdr.read` permission.
- 2026-11-19 — **Phase 12O-2k — MFA enroll / manage (Account & security).** Self-service two-factor
  management on a new `/account` page (reached from the account menu; no module permission — any
  authenticated member; the API authorizes every action). `<MfaSettings>` reads the authoritative
  `mfaEnabled` from `GET /v1/auth/me` and drives the already-contracted TOTP lifecycle: enroll
  (`POST /v1/auth/mfa/enroll` → otpauth URI; new `enrollMfa` action) shows the base32 setup key for
  manual authenticator entry → prove a 6-digit code to enable (`.../mfa/enable`; new `enableMfa`) →
  one-time recovery codes revealed once → step-up disable (`.../mfa/disable`; new `disableMfa`) in a
  confirm dialog requiring the current password AND a TOTP/recovery code. No QR dependency (setup key
  shown as copy-ready text). Account link added to the user menu. No contract change (endpoints already
  covered; response types aliased from the generated `operations`). +9 unit tests (web 120 → 129).
  **No backend/API/schema/DI change.** typecheck ✓, lint ✓, `next build` ✓. Deferred: a QR-code render
  for enrollment, a type-to-confirm guard for engine sync/rollback, a `cdr.read` permission.
- 2026-11-19 — **Phase 12O-2l — type-to-confirm guard on engine sync / rollback (ADR-0019 addendum).**
  The destructive engine actions (Sync, Roll back) now require the operator to type the exact engine
  name in the confirm dialog before the action is enabled — a mis-click guard for when a real connector
  is wired (today both still return the honest `501 NOT_IMPLEMENTED` under the Null connector). The CTA
  is disabled until the typed name matches exactly (case-sensitive, trimmed); the typed value resets
  when the dialog opens on a new action or closes. Health-check stays direct (non-destructive).
  `EngineActions` gains an `engineName` prop (passed from the detail view). UX only — the API re-checks
  permission + platform on every call. +2 unit tests (web 129 → 131). **No contract/backend/API/schema/
  DI change.** typecheck ✓, lint ✓, `next build` ✓. Deferred: a QR-code render for MFA enrollment,
  a `cdr.read` permission, the remaining tenant read screens.
- 2026-11-19 — **Phase 12O-2m — `cdr.read` permission (RBAC catalog).** Introduced a dedicated
  `cdr.read` permission (resource `cdr`, action `read`, billing group) so CDRs no longer borrow
  billing's `wallet.read`. Granted to the roles that can see billing today — owner (via `*`), operator,
  auditor — so CDR visibility is unchanged; admin stays without (it has no `wallet.read` either). The
  seed is catalog-driven and idempotent, so the key + role links land on the next `prisma db seed` (no
  migration — permissions are seeded rows, not schema). Frontend: the CDRs nav/route gate re-points from
  `wallet.read` to `cdr.read`. No contract change (`MeContext.permissions` is a free-form `string[]`;
  no CDR route exists yet — those land in Phase 14). Tests: API catalog +1 (`cdr.read` catalogued in
  billing and held by owner/operator/auditor); web nav/nav-list tests updated. **API unit 186 → 187,
  web 131 (updated). typecheck ✓, lint ✓, `next build` ✓.** API e2e not run here (the test DB on :5433
  is down; the change is additive, data-only, and unit-covered — no controller/guard/route touched).
  Deferred: a QR-code render for MFA enrollment, the remaining tenant read screens.
- 2026-11-19 — **Phase 12O-2n — QR-code render for MFA enrollment.** The MFA setup step now shows a
  scannable QR code of the `otpauth://` provisioning URI above the manual setup key (relabelled the
  scan fallback — "Can't scan? Enter this key manually"). Rendered with a new dependency,
  **`qrcode.react@4.2.0`** (pinned exact; zero transitive deps; React 19 peer support; SVG output —
  SSR-safe, crisp, themeable). The QR is drawn dark-on-white with a quiet zone regardless of app theme
  so it always scans, and carries an accessible `<title>`. Frontend-only; no contract/backend change.
  Tests: the enroll test asserts the QR is fed the full otpauth URI (qrcode.react stubbed) and the
  manual key remains the fallback (web still 131). typecheck ✓, lint ✓, `next build` ✓ (`/account`
  5.2 → 11.3 kB). Deferred: the remaining tenant read screens.
- 2026-11-19 — **Phase 12O-2o — carriers read screen (contract-first).** First tenant-connectivity
  screen: a read-only `/carriers` list of the session's visible carriers (own + system), gated on
  `carrier.read`. Contract-first (ADR-0002): authored `GET /v1/telecom/carriers` (cursor pagination;
  `limit`/`cursor`/`status`/`regionId`/`scope`/`q`) and schemas `Carrier`/`CarrierCredentialRef`/
  `CarrierHealth`/`CarrierPage` into `telvyn.v1.yaml` from the real backend view, then regenerated
  `schema.ts` (never hand-edited). Health is honest UNKNOWN (no carrier probe exists); secrets never
  appear (only a non-secret credential reference). New `carriers-actions.ts` (`listCarriers`), a
  `<CarriersView>` (first page + Load more, loading/empty/error states, scope/status/health badges),
  `/carriers` route + page, and a **Carriers** nav item (phase 10, `carrier.read`, not platform-only).
  Only the list endpoint was contracted (per-screen as consumed); `GET …/{id}` + create/update/delete
  stay for later. +4 web unit tests (131 → 135). **No backend/API change** (the carrier API already
  existed + was documented). typecheck ✓, lint ✓, `next build` ✓. Deferred: carrier detail drawer,
  list filters (scope/status/search), and the sip-trunk/did/routing/lcr read screens.
- 2026-11-19 — **Phase 12O-2p — SIP trunks read screen (contract-first).** A read-only `/sip-trunks`
  list of the tenant's own trunks, gated on `sip_trunk.read`. Contract-first (ADR-0002): authored
  `GET /v1/telecom/sip-trunks` (cursor pagination; `status`/`direction`/`transport`/`carrierId`/`q`) and
  schemas `SipTrunk`/`SipTrunkPage`/`SipTrunkCredentialRef`/`SipTrunkHealth`/`CarrierSummary` into
  `telvyn.v1.yaml` from the real backend view, then regenerated `schema.ts`. Control-plane config only —
  health is honest UNKNOWN (no live connectivity); secrets never appear (non-secret credential reference
  + carrier summary only). New `sip-trunks-actions.ts` (`listSipTrunks`), a `<SipTrunksView>` (first page
  + Load more; loading/empty/error states; carrier, direction, transport (+TLS), endpoint, status,
  health columns), `/sip-trunks` route + page, and a **SIP trunks** nav item (phase 11, `sip_trunk.read`,
  tenant-scoped). Only the list endpoint was contracted (per-screen as consumed); `…/{id}` + mutations
  stay for later. +4 web unit tests (135 → 139). **No backend/API change** (the SIP-trunk API already
  existed + was documented). typecheck ✓, lint ✓, `next build` ✓. Deferred: trunk detail drawer, list
  filters, and the did/routing/lcr read screens.
- 2026-11-19 — **Phase 12O-2q — DIDs (Numbers) read screen (contract-first).** The existing `/numbers`
  module placeholder is replaced by the real DID inventory — a read-only list of the tenant's own
  numbers with their lifecycle status, gated on `did.read` (the Numbers nav item already existed; no nav
  change). Contract-first (ADR-0002): authored `GET /v1/telecom/dids` (cursor pagination;
  `status`/`carrierId`/`sipTrunkId`/`routingProfileId`/`regionId`/`country`/`q`) and schemas `Did`/
  `DidPage`/`DidHealth` into `telvyn.v1.yaml` from the real backend view, then regenerated `schema.ts`.
  Control-plane only — health is honest UNKNOWN (no live SIP-path check). The DID API returns reference
  ids only (no embedded objects), so carrier/trunk render as short refs (full id on hover). New
  `dids-actions.ts` (`listDids`), a `<NumbersView>` (first page + Load more; loading/empty/error states;
  number, country, lifecycle status, carrier/trunk refs, assigned date, health), and the `/numbers`
  page swapped from `ModuleGate` to the live view. Only the list endpoint was contracted (per-screen as
  consumed); `…/{id}` + mutations stay for later. +4 web unit tests (139 → 143). **No backend/API change**
  (the DID API already existed + was documented). typecheck ✓, lint ✓, `next build` ✓. Deferred: DID
  detail drawer, list filters (status/country/search), and the routing/lcr read screens.
- 2026-11-19 — **Phase 12O-2r — routing profiles read screen (contract-first).** A read-only `/routing`
  list of the tenant's own routing profiles, gated on `routing.read`. Contract-first (ADR-0002): authored
  `GET /v1/telecom/routing-profiles` (cursor pagination; `status`/`direction`/`strategy`/`q`) and schemas
  `RoutingProfile`/`RoutingPolicy`/`RoutingRule`/`RoutingProfilePage` into `telvyn.v1.yaml` from the real
  backend view (the list returns each profile's full policy + ordered rules), then regenerated
  `schema.ts`. Declarative config only — nothing is executed. New `routing-actions.ts`
  (`listRoutingProfiles`), a `<RoutingView>` (per-profile summary — direction, status, selection
  strategy, failover on/off, rule count, version; first page + Load more; loading/empty/error states),
  `/routing` route + page, and a **Routing** nav item (phase 12, `routing.read`, tenant-scoped). The full
  rules belong in a detail drawer (deferred). Only the list endpoint was contracted (per-screen as
  consumed); `…/{id}` + mutations stay for later. +4 web unit tests (143 → 147). **No backend change**;
  docs-only API.md touch-up (added the `strategy` filter to the documented list query). typecheck ✓,
  lint ✓, `next build` ✓. Deferred: routing detail drawer + filters, and the LCR read screen.
- 2026-11-19 — **Phase 12O-2s — LCR policies read screen (contract-first).** A read-only `/lcr` list of
  the tenant's own least-cost-routing policies, gated on `routing.read` (LCR is part of the routing
  domain). Contract-first (ADR-0002): authored `GET /v1/telecom/lcr-policies` (cursor pagination;
  `enabled`/`strategy`/`q`) and schemas `LcrPolicy`/`LcrRoute`/`LcrPolicyPage` into `telvyn.v1.yaml` from
  the real backend view (the list returns each policy's route candidates in deterministic selection
  order; `costMicros` is a JSON-safe integer), then regenerated `schema.ts`. Declarative route selection
  only — nothing executed, rated or billed. New `lcr-actions.ts` (`listLcrPolicies`), an `<LcrView>`
  (per-policy summary — selection strategy, enabled state, candidate count, version; first page + Load
  more; loading/empty/error states), `/lcr` route + page, and an **LCR** nav item (phase 12,
  `routing.read`, tenant-scoped). The ordered candidates belong in a detail drawer (deferred). Only the
  list endpoint was contracted (per-screen as consumed); `…/{id}` + mutations stay for later. +4 web unit
  tests (147 → 151). **No backend/API change** (the LCR API already existed + was documented). typecheck
  ✓, lint ✓, `next build` ✓. This completes the telecom read-screen set (carriers, SIP trunks, numbers,
  routing, LCR). Deferred: detail drawers + list filters across all telecom read screens.
- 2026-11-19 — **Phase 12O-2t — carrier detail drawer (contract-first).** The first read-screen detail
  view: a "View" action on each carriers row opens a drawer with the full carrier, fetched fresh by id.
  Contract-first (ADR-0002): authored `GET /v1/telecom/carriers/{id}` into `telvyn.v1.yaml` (reusing the
  existing `Carrier` schema; 404 for foreign/removed — IDOR-safe), then regenerated `schema.ts`. New
  `getCarrier(id)` action; `<CarrierDetailDrawer>` (keyed by id → refetch per open; loading/error/404
  states) shows scope, type, country, status, health (honest UNKNOWN), priority, codecs, CPS/concurrency
  caps, the non-secret credential reference, and created/updated. Read-only; `carrier.read` re-checked
  server-side. +1 web unit test (151 → 152). **No backend/API change** (the endpoint already existed +
  was documented). typecheck ✓, lint ✓, `next build` ✓. Sets the detail-view pattern for trunks/DIDs/
  routing/LCR. Deferred: the remaining detail drawers + list filters.
- 2026-11-19 — **Phase 12O-2u — SIP trunk detail drawer (contract-first).** Applies the 2t detail-view
  pattern to SIP trunks: a "View" action on each `/sip-trunks` row opens a drawer with the full trunk,
  fetched fresh by id. Contract-first (ADR-0002): authored `GET /v1/telecom/sip-trunks/{id}` into
  `telvyn.v1.yaml` (reusing the existing `SipTrunk` schema; 404 for foreign/removed — IDOR-safe), then
  regenerated `schema.ts` (additive). New `getSipTrunk(id)` action; `<SipTrunkDetailDrawer>` (keyed by
  id → refetch per open; loading/error/404 states) shows the carrier summary (name + scope), direction,
  endpoint (host/SIP URI), port, transport (+ TLS), auth mode, allowed-IP ACL, codecs, SRTP, DTMF mode,
  CPS/concurrency caps, administrative status, health (honest UNKNOWN — no live connectivity), the
  non-secret credential reference, and created/updated. Read-only; `sip_trunk.read` re-checked
  server-side; secrets never rendered. +1 web unit test (152 → 153; full web suite 153 ✓). **No
  backend/API change** (the endpoint already existed + was documented in `API.md`). `next build` ✓.
  Deferred: detail drawers for DIDs/routing/LCR + list filters across the read screens.
- 2026-11-19 — **Phase 12O-2v — DID (number) detail drawer (contract-first).** Applies the 2t/2u
  detail-view pattern to the Numbers inventory: a "View" action on each `/numbers` row opens a drawer
  with the full DID, fetched fresh by id. Contract-first (ADR-0002): authored `GET /v1/telecom/dids/{id}`
  into `telvyn.v1.yaml` (reusing the existing `Did` schema; 404 for foreign/pool/removed — IDOR-safe),
  then regenerated `schema.ts` (additive). New `getDid(id)` action; `<NumberDetailDrawer>` (keyed by id →
  refetch per open; loading/error/404 states) shows country, lifecycle status, health (honest UNKNOWN —
  no live SIP-path check), and the related-resource **reference ids** (carrier / SIP trunk / routing
  profile / region) in full mono (the DID API returns ids only, never embedded objects — the list shows
  8-char refs, the drawer the full ids), plus assigned/created/updated. Read-only; `did.read` re-checked
  server-side. +1 web unit test (153 → 154; full web suite 154 ✓). **No backend/API change** (the endpoint
  already existed + was documented in `API.md`). `next build` ✓ (first run hit the known transient
  `next/font` Google-Fonts fetch failure in `layout.tsx`; a clean retry with no code change succeeded).
  Deferred: detail drawers for routing/LCR + list filters across the read screens.
- 2026-11-19 — **Phase 12O-2w — routing profile detail drawer (contract-first).** Applies the detail-view
  pattern to Routing, and surfaces what the 2r list deliberately summarized: a "View" action on each
  `/routing` row opens a drawer with the full profile — its complete selection/failover **policy** and
  its **ordered rule set** (priority ASC) — fetched fresh by id. Contract-first (ADR-0002): authored
  `GET /v1/telecom/routing-profiles/{id}` into `telvyn.v1.yaml` (reusing the existing `RoutingProfile`
  schema; 404 for foreign/removed — IDOR-safe), then regenerated `schema.ts` (additive). Added
  `RoutingRule`/`RoutingPolicy` ergonomic aliases to `contracts/index.ts`. New `getRoutingProfile(id)`
  action; `<RoutingDetailDrawer>` (keyed by id → refetch per open; loading/error/404 states) shows
  direction, status, description, selection strategy, failover on/off + conditions, max-attempts and
  overall-timeout caps, version, timestamps, and each rule (priority, destination type + value, enabled
  state, optional weight/timeout/failover) rendered in priority order. Declarative config only — nothing
  is executed. Read-only; `routing.read` re-checked server-side. +1 web unit test (154 → 155; full web
  suite 155 ✓). **No backend/API change** (the endpoint already existed + was documented in `API.md`).
  `next build` ✓ (a first run surfaced a missing `RoutingRule` export, fixed by the index alias, then
  clean). Deferred: the LCR detail drawer + list filters across the read screens.
- 2026-11-19 — **Phase 12O-2x — LCR policy detail drawer (contract-first).** Completes the read-screen
  detail-drawer set (carriers, SIP trunks, DIDs, routing, LCR). A "View" action on each `/lcr` row opens a
  drawer with the full least-cost-routing policy and its **route candidates in the server's deterministic
  selection order** (NOT re-sorted — order is strategy-dependent, e.g. LOWEST_COST), fetched fresh by id.
  Contract-first (ADR-0002): authored `GET /v1/telecom/lcr-policies/{id}` into `telvyn.v1.yaml` (reusing
  the existing `LcrPolicy` schema; 404 for foreign/removed — IDOR-safe), then regenerated `schema.ts`
  (additive). Added the `LcrRoute` ergonomic alias to `contracts/index.ts`. New `getLcrPolicy(id)` action;
  `<LcrDetailDrawer>` (keyed by id → refetch per open; loading/error/404 states) shows selection strategy,
  enabled state, description, version, timestamps, and each candidate (priority, prefix + country, cost
  formatted from integer `costMicros` millionths + currency — never float money, raw micros in the title,
  enabled state, optional weight + effective window). Declarative selection only — nothing executed, rated
  or billed. Read-only; `routing.read` re-checked server-side. +1 web unit test (155 → 156; full web suite
  156 ✓). **No backend/API change** (the endpoint already existed + was documented in `API.md`). `next
  build` ✓. Deferred: list filters across the read screens; the Admin/members read screen.
- 2026-11-20 — **Phase 12O-2y — list filters: shared primitive + carriers screen (contract-first).**
  First read-screen filter sub-phase. Adds a reusable `useDebouncedValue(value, delayMs)` hook and a
  presentational `<ListFilters>` primitive (a debounce-ready search box + any number of accessible native
  `<select>` controls + a Clear action shown only when a filter is active; `role="search"` landmark),
  then wires it into the **Carriers** screen: search (`q`, 300 ms debounced), status, and scope, each
  mapped to the list endpoint's **already-contracted** query params. No contract/schema change — pure
  UI→existing-param wiring (the carriers list already documented `status`/`scope`/`q`). Filter changes
  reset pagination and refetch (memoized params; Load-more carries the active filters); an active filter
  that returns nothing now shows an honest **"No carriers match your filters."** state (distinct from the
  "none configured yet" empty state) with Clear. `regionId` is left out of the UI (no region picker yet).
  Read-only; server still authoritative + auto-scoped. +9 web unit tests (156 → 165; full web suite 165 ✓,
  33 files): 3 for the hook (fake timers), 3 for the primitive, 3 for the carriers screen (status refetch,
  debounced search refetch, no-matches + Clear). `next build` ✓. Sets the filter pattern for the other
  read screens (SIP trunks, numbers, routing, LCR), each a following sub-phase.
- 2026-11-20 — **Phase 12O-2z — list filters: SIP trunks screen.** Applies the 12O-2y filter pattern
  (the `<ListFilters>` primitive + `useDebouncedValue` hook) to the **SIP trunks** read screen: search
  (`q`, 300 ms debounced), status, direction, and transport, each mapped to the list endpoint's
  **already-contracted** query params (`status`/`direction`/`transport`/`carrierId`/`q`). No
  contract/schema change — pure UI→existing-param wiring; verified the backend service genuinely applies
  all four filters (`sip-trunks.service.ts` `where`), so no filter is a dishonest no-op. Filter changes
  reset pagination and refetch (memoized params; Load-more carries the active filters); an active filter
  that returns nothing shows an honest **"No SIP trunks match your filters."** state (distinct from the
  "none configured yet" empty state) with Clear. `carrierId` is left out of the UI (no carrier picker yet,
  mirroring `regionId` on carriers). Read-only; server still authoritative + tenant-auto-scoped. +4 web
  unit tests (165 → 169; full web suite 169 ✓, 33 files): status refetch, direction refetch, debounced
  search refetch, no-matches + Clear. `next build` ✓ (/sip-trunks 5.79 kB). No new reusable code — reuses
  the 2y primitive. Next: numbers, routing, LCR.
- 2026-11-20 — **Phase 12O-2aa — list filters: numbers (DIDs) screen.** Applies the 12O-2y filter
  pattern (the `<ListFilters>` primitive + `useDebouncedValue` hook) to the **Numbers** read screen:
  search (`q`, 300 ms debounced — a substring match against the canonical E.164) and status (the 7-value
  DID lifecycle enum), each mapped to the list endpoint's **already-contracted** query params. No
  contract/schema change — pure UI→existing-param wiring; verified the backend service genuinely applies
  both (`dids.service.ts` `where.status` + `where.e164 contains`), so neither is a dishonest no-op. Filter
  changes reset pagination and refetch (memoized params; Load-more carries the active filters); an active
  filter that returns nothing shows an honest **"No numbers match your filters."** state (distinct from the
  "none in inventory yet" empty state) with Clear. The id-based filters (`carrierId`/`sipTrunkId`/
  `routingProfileId`/`regionId`) are left out — no picker exists yet (mirrors prior screens); `country` is
  also left out — it has no canonical option source (no countries endpoint) and its zod DTO demands exactly
  two uppercase chars, so a free-text box would be 400-prone, and `q` already covers finding a number.
  Read-only; server still authoritative + tenant-auto-scoped (the platform inventory pool and other
  tenants' numbers are never returned). +3 web unit tests (169 → 172; full web suite 172 ✓, 33 files):
  status refetch, debounced search refetch, no-matches + Clear. `next build` ✓ (/numbers 5.36 kB). No new
  reusable code — reuses the 2y primitive. Next: routing, LCR.
- 2026-11-20 — **Phase 12O-2ab — list filters: routing profiles screen.** Applies the 12O-2y filter
  pattern (the `<ListFilters>` primitive + `useDebouncedValue` hook) to the **Routing** read screen:
  search (`q`, 300 ms debounced — case-insensitive name), status, direction (inbound/outbound), and
  strategy (priority / weighted / round-robin / simultaneous), each mapped to the list endpoint's
  **already-contracted** query params (`status`/`direction`/`strategy`/`q`). No contract/schema change —
  pure UI→existing-param wiring; verified the backend service genuinely applies all four
  (`routing.service.ts` `where.status`/`direction`/`selectionStrategy` + case-insensitive `name contains`),
  so no filter is a dishonest no-op. Filter changes reset pagination and refetch (memoized params;
  Load-more carries the active filters); an active filter that returns nothing shows an honest **"No
  routing profiles match your filters."** state (distinct from the "none configured yet" empty state) with
  Clear. Declarative config only — nothing is executed. Read-only; server still authoritative +
  tenant-auto-scoped. +4 web unit tests (172 → 176; full web suite 176 ✓, 33 files): status refetch,
  strategy refetch, debounced search refetch, no-matches + Clear. `next build` ✓ (/routing 5.74 kB). No new
  reusable code — reuses the 2y primitive. Next: LCR.
- 2026-11-20 — **Phase 12O-2ac — list filters: LCR policies screen (+ a backend `enabled`-filter bug
  fix).** Completes the read-screen filter set (carriers / SIP trunks / numbers / routing / LCR). Applies
  the 12O-2y filter pattern (the `<ListFilters>` primitive + `useDebouncedValue` hook) to the **LCR** read
  screen: search (`q`, 300 ms debounced — case-insensitive name), strategy (lowest-cost / highest-priority
  / weighted / quality-first), and a tri-state **state** filter (enabled / disabled), each mapped to the
  list endpoint's **already-contracted** query params (`strategy`/`q`/`enabled`). **No contract change.**
  **Backend fix (the one deviation from the frontend-only pattern):** the list query's `enabled` used
  `z.coerce.boolean()` (`Boolean("false") === true`), so a contracted `enabled=false` silently inverted
  into `enabled=true` — a dishonest filter. Replaced with an explicit string→boolean parse
  (`"true"→true`, `"false"→false`, real booleans pass through, anything else → 400) in `lcr.dto.ts`, with a
  new `lcr.dto.test.ts` (5 unit tests) proving both directions. Verified `lcr.service.ts` genuinely applies
  `where.enabled`/`selectionStrategy` + case-insensitive `name contains`. The UI maps its state select to a
  real boolean (`enabled: value === "true"`). Filter changes reset pagination and refetch; an active filter
  that returns nothing shows an honest **"No LCR policies match your filters."** state (distinct from the
  "none configured yet" empty state) with Clear. Declarative selection only — nothing executed, rated or
  billed; `costMicros` stays an integer. Read-only; server still authoritative + tenant-auto-scoped. Tests:
  +4 web (176 → 180; full web suite 180 ✓, 33 files — strategy refetch, state=true/false → real boolean,
  debounced search, no-matches + Clear; one pre-existing summary assertion disambiguated badge-vs-option)
  and +5 API unit (187 → 192 unit, 20 files). `next build` ✓ (/lcr 5.48 kB); API `tsc`/eslint ✓. No
  `API.md` change — the contract already declared `enabled: boolean`; this made the implementation honour
  it. Next: the Admin/members read screen; landing the stack.
- 2026-11-20 — **Phase 12O-2ad — Admin / Members read screen (contract-first).** Replaces the `/admin`
  `ModuleGate` placeholder with a real read-only members list — the last NOC/admin read surface. The
  backend endpoint already existed (`GET /v1/members`, `member.read`, `authz.controller.ts` →
  `tenancy.listMembers()`); this phase **authored it into the contract** (new `Member` schema + path in
  `telvyn.v1.yaml`, from the real service shape) and regenerated `schema.ts` (additive — 0 removed lines) +
  added a `Member` alias in `contracts/index.ts`. The endpoint returns a JSON **array** (a team is small —
  no pagination, no query params), so the screen loads the full list via `useResource` (load-on-mount +
  Refresh + abort-on-unmount) — no Load-more. New `lib/admin/members-actions.ts` `listMembers()`; new
  `components/admin/members-view.tsx` `<MembersView>` (table: name / email / membership status ACTIVE·
  SUSPENDED / account status ACTIVE·INVITED·DISABLED / role-name badges; honest loading / empty / error;
  null full name → "—"; no secrets). `app/admin/page.tsx` now renders `<MembersView>` directly. The route
  is already gated — nav `member.read` + `RouteGuard` (not platform-only, so visible to any tenant member
  with `member.read`); the server auto-scopes to the session's tenant and re-checks every request.
  Read-only — member management (invite / role changes) is a later phase. +3 web unit tests (180 → 183;
  full web suite 183 ✓, 34 files — list render, empty, error). `next build` ✓ (/admin now a real 3.73 kB
  route). **No backend change** (the endpoint and its tenant-scoping already existed + were e2e-covered).
  `API.md` updated. Next: landing the stack.
- 2026-11-20 — **Phase 12O-2ae — carrier create / edit / delete (first write slice, contract-first).**
  The first mutating resource screen. The carrier POST/PATCH/DELETE endpoints already existed
  (`carriers.controller.ts`, perms `carrier.create` / `carrier.update` / `carrier.delete`, scope/ownership
  server-derived, mutations audited with a credential **reference** only); this phase **authored them into
  the contract** (new `CreateCarrier`, `UpdateCarrier`, `InlineCredentialInput` schemas + POST on the
  collection and PATCH/DELETE on the item path in `telvyn.v1.yaml`), regenerated `schema.ts` (additive —
  the only change was `post/patch/delete: never` placeholders becoming real operations) and added
  `CreateCarrier` / `UpdateCarrier` aliases. New `createCarrier` / `updateCarrier` / `deleteCarrier`
  actions. New `<CarrierForm>` modal (create + edit): name, type, status, country (ISO-2, uppercased +
  client-validated), priority, max CPS, max concurrent calls, and codec checkboxes — client-side
  range/format validation with per-field errors, server-side re-validation authoritative. The detail
  drawer gained **Edit** / **Delete** footer actions (gated on `carrier.update` / `carrier.delete` via
  `useSession`); carriers-view gained a **New carrier** button (gated on `carrier.create`) and a
  soft-delete confirm dialog; every mutation reloads the list. **Scope deliberately bounded:** `regionId`
  (no picker yet) and credential attachment (secret handling) are **deferred** to a later slice — both stay
  optional + fully available on the API; editing here never touches them. In edit mode, clearing an
  optional numeric leaves it unchanged (the DTO has no "unset" for those). All gating is UX-only; the API
  re-checks `carrier.*` and re-validates every call, and stays tenant/scope-authoritative. +3 web unit
  tests (183 → 186; full web suite 186 ✓, 34 files — create-and-reload, New-carrier hidden without
  `carrier.create`, delete-via-drawer-after-confirm; existing carrier tests now wrap `SessionProvider`).
  `next build` ✓ (/carriers 5.69 kB); eslint ✓. **No backend change** (endpoints + audit + tenant-scoping
  pre-existed, e2e-covered). `API.md` updated. Next: roll the write pattern to the other resources (one per
  sub-phase), or land the stack.
- 2026-11-22 — **Phase 12O-2af — SIP trunk create / edit / delete (second write slice, contract-first).**
  Rolls the 12O-2ae carrier mutation pattern to SIP trunks. The trunk POST/PATCH/DELETE endpoints already
  existed (`sip-trunks.controller.ts`, perms `sip_trunk.create` / `sip_trunk.update` / `sip_trunk.delete`;
  ownership server-derived, `carrierId` scope-validated, endpoint values SSRF-validated, mutations audited
  with credential **reference** only); this phase **authored them into the contract** (new `CreateSipTrunk`,
  `UpdateSipTrunk`, `InlineSipCredentialInput` schemas + POST on the collection and PATCH/DELETE on the item
  path in `telvyn.v1.yaml`), regenerated `schema.ts` (additive — `post/patch/delete: never` placeholders
  became real operations) and added `CreateSipTrunk` / `UpdateSipTrunk` aliases. New `createSipTrunk` /
  `updateSipTrunk` / `deleteSipTrunk` actions. New `<SipTrunkForm>` modal (create + edit): name, **carrier
  picker** (required FK — loaded from the first page of `listCarriers`, seeded in edit with the trunk's
  current carrier so it always shows), direction, host, SIP URI, port (1–65535, client-validated), transport,
  TLS/SRTP checkboxes, auth mode, allowed-IPs textarea (newline/comma → list; server validates IP/CIDR), max
  CPS / max concurrent calls, DTMF mode, codec checkboxes. The detail drawer gained **Edit** / **Delete**
  footer actions (gated on `sip_trunk.update` / `sip_trunk.delete` via `useSession`); sip-trunks-view gained
  a **New trunk** button (gated on `sip_trunk.create`) and a soft-delete confirm dialog; every mutation
  reloads the list. **Scope deliberately bounded:** credential attachment (`credentialId` / inline
  `credential` secret) is **deferred** to a later secret-handling slice — both stay optional + fully
  available on the API, and `authMode` can still be set. All gating is UX-only; the API re-checks
  `sip_trunk.*`, re-validates every field, and stays tenant/scope-authoritative. +3 web unit tests
  (186 → 189; full web suite 189 ✓, 34 files — create-with-carrier-picker-and-reload, New-trunk hidden
  without `sip_trunk.create`, delete-via-drawer-after-confirm; existing trunk tests now wrap
  `SessionProvider`). `next build` ✓ (/sip-trunks 7.08 kB); eslint ✓. **No backend change** (endpoints +
  audit + tenant-scoping + SSRF validation pre-existed, e2e-covered). `API.md` updated. Next: roll the
  pattern to numbers / routing / LCR / member management (one per sub-phase), the deferred carrier/trunk
  credential slice, or land the stack.
- 2026-11-22 — **Phase 12O-2ag — DID (Numbers) create / edit / delete (third write slice, contract-first).**
  Rolls the write pattern to Numbers. The DID POST/PATCH/DELETE endpoints already existed (`dids.controller.ts`,
  all gated by the single `did.manage` perm; ownership server-derived, `number` normalized to canonical E.164
  + `country` derived server-side, relationship refs validated for scope/existence with a carrier↔trunk
  consistency rule, duplicate number → 409, mutations audited with reference ids only); this phase **authored
  them into the contract** (new `CreateDid` / `UpdateDid` schemas + POST on the collection and PATCH/DELETE on
  the item path in `telvyn.v1.yaml`), regenerated `schema.ts` (additive — `never` placeholders became real
  operations) and added `CreateDid` / `UpdateDid` aliases. New `createDid` / `updateDid` / `deleteDid` actions.
  New `<NumberForm>` modal (create + edit): on create a raw number (normalized server-side) + optional status +
  optional carrier / SIP trunk / routing-profile **pickers** (each loads the first page of its list and merges a
  seeded current id labelled by id until the name loads, since the DID API returns ids only; a picker whose list
  can't load surfaces its error and leaves None/current); on edit the number is shown read-only (immutable),
  status + the three refs editable, and clearing a picker sends an explicit `null` to detach. Detail drawer
  gained **Edit** / **Delete** footer actions (gated on `did.manage` via `useSession`); numbers-view gained a
  **New number** button (gated on `did.manage`) and a soft-delete confirm dialog; every mutation reloads the
  list. **Scope deliberately bounded:** the `regionId` reference is **deferred** (optional on the API; editing
  never touches it). **Honesty note / constitution gap surfaced:** the 12G service does NOT enforce
  status-*transition* rules — `status` is a free administrative field, so the UI is a plain select, not a
  guarded state machine; this is pre-existing backend behavior, not introduced here, and is flagged for a future
  backend slice. All gating is UX-only; the API re-checks `did.manage`, re-normalizes the number, and
  re-validates every relationship on each call. +3 web unit tests (189 → 192; full web suite 192 ✓, 34 files —
  create-and-reload, New-number hidden without `did.manage`, delete-via-drawer-after-confirm; existing number
  tests now wrap `SessionProvider`). `next build` ✓ (/numbers 5.61 kB); eslint ✓. **No backend change**
  (endpoints + audit + tenant-scoping + E.164 normalization + relationship validation pre-existed, e2e-covered).
  `API.md` updated. Next: roll the pattern to routing / LCR / member management (one per sub-phase), the deferred
  carrier/trunk credential + DID region slice, or land the stack.
- 2026-11-22 — **Phase 12O-2ah — routing profile create / edit / delete, PROFILE + POLICY only (fourth write
  slice, contract-first).** Rolls the write pattern to Routing — but bounded (owner-chosen): this slice manages
  the profile envelope (name, direction, description, status) + the selection/failover POLICY
  (selectionStrategy, failoverEnabled, failoverConditions, maxAttempts, overallTimeoutSeconds); the ordered
  rules editor is a dedicated later slice (12O-2ai). The POST/PATCH/DELETE endpoints already existed (Phase
  12H/12I, `routing.controller.ts`, all gated by the single `routing.manage` perm; ownership server-derived,
  declarative config only — nothing executed, destinations SSRF/E.164/owned-trunk validated server-side, dup
  name → 409, atomic optimistic concurrency via `expectedVersion`, audited with counts/status only); this phase
  **authored them into the contract** (new `CreateRoutingProfile` / `UpdateRoutingProfile` + `RoutingRuleInput`
  / `RoutingScheduleInput` schemas — the contract now fully describes the `rules[]` body even though this UI
  doesn't send it — + POST on the collection and PATCH/DELETE on the item path in `telvyn.v1.yaml`),
  regenerated `schema.ts` (additive — `never` placeholders became real operations) and added
  `CreateRoutingProfile` / `UpdateRoutingProfile` / `RoutingRuleInput` aliases. New `createRoutingProfile` /
  `updateRoutingProfile` / `deleteRoutingProfile` actions. New `<RoutingForm>` modal (create + edit): profile
  fields + a Policy fieldset (strategy select, Enable-failover checkbox, failover-condition checkboxes, max
  attempts 1–20, overall timeout 1–3600) with client-side range validation and the "failover enabled ⇒ ≥1
  condition" rule mirrored. **Rules are intentionally never sent:** create omits `rules` (empty rule set to
  start) and edit omits `rules` so the backend preserves the existing set (it only replaces when `rules` is
  present) — so a policy/metadata edit can't accidentally wipe carefully-built rules. Edit sends
  `expectedVersion` (the loaded profile's version) for optimistic concurrency → a concurrent change surfaces the
  API's 409. Detail drawer gained **Edit** / **Delete** footer actions (gated on `routing.manage` via
  `useSession`); routing-view gained a **New profile** button (gated on `routing.manage`) and a soft-delete
  confirm dialog (notes rules go with it); every mutation reloads the list. All gating is UX-only; the API
  re-checks `routing.manage` and re-validates every call, staying tenant/scope-authoritative. +3 web unit tests
  (192 → 195; full web suite 195 ✓, 34 files — create-without-rules-and-reload incl. an assertion the body has
  no `rules` key, New-profile hidden without `routing.manage`, delete-via-drawer-after-confirm; existing routing
  tests now wrap `SessionProvider`). `next build` ✓ (/routing 6.25 kB; the usual `next/font/google` fetch flake
  needed one retry, not a code issue); eslint ✓. **No backend change** (endpoints + audit + tenant-scoping +
  optimistic concurrency + destination validation pre-existed, e2e-covered). `API.md` updated. Next: the
  routing rules editor (12O-2ai), roll the pattern to LCR / member management, the deferred credential/region
  slices, or land the stack.
- 2026-11-22 — **Phase 12O-2ai — routing rules editor (frontend only, no contract/backend change).** Completes
  the routing write surface that 12O-2ah deferred. New `<RoutingRulesEditor>` modal, opened by an **"Edit
  rules"** footer action on the routing detail drawer (gated on `routing.manage` alongside Edit/Delete). It
  loads the profile's full ordered rule set and, on save, PATCHes the **complete** `rules` array via the
  existing `updateRoutingProfile` action (no new action) with `expectedVersion` — so a concurrent change
  surfaces the API's 409 rather than clobbering. **Replace-semantics safety:** because PATCH replaces the whole
  set, the editor round-trips every rule; the per-rule advanced options this slice does NOT expose — carrier
  tag, typed failover (`failoverDestination`/`failoverDestinationType`/`failoverAfterSeconds`), and time-of-day
  `schedule` — are preserved verbatim on existing rules (a "+ advanced preserved" chip marks such a rule), so
  editing a rule's destination can't silently drop its failover/schedule. Editable per rule: destination type
  (PHONE_NUMBER / EXTENSION / SIP_TRUNK / VOICEMAIL / WEBHOOK, with a per-type hint), destination value,
  priority (sets ascending order), enabled, weight, timeout, retries; add / remove rules; client range
  validation per field with a per-row error; the server validates each destination per type (SSRF-safe
  webhooks, canonical E.164, owned trunk ids) and is authoritative. Saving an empty set removes all rules
  (valid). **No contract change** — the `RoutingRuleInput` / `RoutingScheduleInput` schemas were authored in
  12O-2ah; this is pure UI. +3 web unit tests (195 → 198; full web suite 198 ✓, 34 files — edit-rule-saves-full-
  set-with-expectedVersion-and-preserves-failover, add-rule-grows-the-set, Edit-rules-hidden-without-
  `routing.manage`). `next build` ✓ (/routing 6.25 → 8.03 kB); eslint ✓. **No backend change.** `API.md`
  updated. The routing write surface (profile + policy + rules) is now complete. Next: roll the pattern to LCR /
  member management, the deferred carrier/trunk credential + DID region (+ routing rule failover/schedule)
  slices, or land the stack.
- 2026-11-22 — **Phase 12O-2aj — LCR policy create / edit / delete, POLICY ONLY (fifth write slice,
  contract-first).** Rolls the write pattern to LCR — bounded (owner-chosen, mirroring the routing 2ah/2ai
  split): this slice manages the policy envelope (name, description, selection strategy, enabled); the ordered
  routes editor — which carries the integer `costMicros` money-handling — is a dedicated later slice (12O-2ak,
  owner chose raw-integer-micros entry). The POST/PATCH/DELETE endpoints already existed (Phase 12J,
  `lcr.controller.ts`, all gated by the single `routing.manage` perm — LCR reuses the routing domain's perms;
  ownership server-derived, declarative route SELECTION only — nothing executed/rated/billed, `costMicros` is an
  integer in millionths stored as BigInt, carrier accessible + trunk owned validated, dup name → 409, atomic
  optimistic concurrency via `expectedVersion`, audited with counts/status only); this phase **authored them
  into the contract** (new `CreateLcrPolicy` / `UpdateLcrPolicy` + `LcrRouteInput` schemas — the contract now
  fully describes the `routes[]` body with `costMicros` as a non-negative integer, even though this UI doesn't
  send it — + POST on the collection and PATCH/DELETE on the item path in `telvyn.v1.yaml`), regenerated
  `schema.ts` (additive — `never` placeholders became real operations) and added `CreateLcrPolicy` /
  `UpdateLcrPolicy` / `LcrRouteInput` aliases. New `createLcrPolicy` / `updateLcrPolicy` / `deleteLcrPolicy`
  actions. New `<LcrForm>` modal (create + edit): name (required), description, selection strategy, enabled.
  **Routes are intentionally never sent:** create omits `routes` (empty set to start) and edit omits `routes` so
  the backend preserves the existing route set (it only replaces when `routes` is present) — so a policy edit
  can't wipe route candidates (and their money values). Edit sends `expectedVersion` (the loaded policy's
  version) for optimistic concurrency → a concurrent change surfaces the API's 409. Detail drawer gained
  **Edit** / **Delete** footer actions (gated on `routing.manage` via `useSession`); lcr-view gained a **New
  policy** button (gated on `routing.manage`) and a soft-delete confirm dialog (notes routes go with it); every
  mutation reloads the list. All gating is UX-only; the API re-checks `routing.manage` and re-validates every
  call. +4 web unit tests (198 → 202; full web suite 202 ✓, 34 files — create-without-routes-and-reload incl. an
  assertion the body has no `routes` key, edit-sends-expectedVersion-and-no-routes, New-policy hidden without
  `routing.manage`, delete-via-drawer-after-confirm; existing LCR tests now wrap `SessionProvider`). `next
  build` ✓ (/lcr 5.09 kB); eslint ✓. **No backend change** (endpoints + audit + tenant-scoping + optimistic
  concurrency + costMicros integer handling + carrier/trunk validation pre-existed, e2e-covered). `API.md`
  updated. Next: the LCR routes editor (12O-2ak, raw-micros cost entry), member management write, the deferred
  credential/region/failover-schedule slices, or land the stack.
- 2026-11-22 — **Phase 12O-2ak — LCR routes editor (frontend only, no contract/backend change).** Completes
  the LCR write surface that 12O-2aj deferred. New `<LcrRoutesEditor>` modal, opened by an **"Edit routes"**
  footer action on the LCR detail drawer (gated on `routing.manage` alongside Edit/Delete). It loads the
  policy's full route set and, on save, PATCHes the **complete** `routes` array via the existing
  `updateLcrPolicy` action (no new action) with `expectedVersion` — a concurrent change surfaces the API's 409.
  **Money handling (owner-chosen): `costMicros` is entered as a RAW non-negative INTEGER in millionths of a
  currency unit — no floating point anywhere** (string → integer via a whole-number parse; a hint shows the
  convention, e.g. 12000 = 0.012/min). **Replace-semantics safety:** the editor round-trips every route; the
  per-route options it does NOT expose — `sipTrunkId` and `effectiveFrom`/`effectiveTo` — are preserved
  verbatim on existing routes (a "+ advanced preserved" chip marks such a route), so editing a route's cost/
  carrier can't silently drop its trunk or effective window. Editable per route: carrier (required — a picker
  loaded once from the first page of `listCarriers` and seeded with each route's current id, labelled by id
  until the name loads, since the LCR API returns ids only; a load failure surfaces inline), prefix (required,
  validated `^\+?[0-9]{1,15}$`), cost (required integer micros), currency (required select), priority, weight,
  country (ISO-2), enabled; add / remove routes; client validation per field with a per-row error. The server
  validates carrier accessibility + trunk ownership and is authoritative. Saving an empty set removes all routes
  (valid). **No contract change** — `LcrRouteInput` was authored in 12O-2aj; this is pure UI. +3 web unit tests
  (202 → 205; full web suite 205 ✓, 34 files — edit-saves-full-set-with-expectedVersion-raw-micros-and-preserves-
  trunk/effective, add-route, Edit-routes-hidden-without-`routing.manage`). `next build` ✓ (/lcr 5.09 → 7.45 kB);
  eslint ✓. **No backend change.** `API.md` updated. The LCR write surface (policy + routes) is now complete.
  Next: member management write, the deferred carrier/trunk credential + DID region + routing-rule
  failover/schedule slices, or land the stack.
