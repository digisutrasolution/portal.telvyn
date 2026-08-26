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
