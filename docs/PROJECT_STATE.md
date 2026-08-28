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

**Phase 0 — Foundation & decisions.**

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
