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
