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
