# ROADMAP.md — Telvyn PROMAX Master Build Program

> Owner-defined 20-phase sequence (locked 2026-08-26). Read with
> PROJECT_STATE.md (status taxonomy + blockers) and ADR/. Every phase ships
> under the constitution's definition of done: production-ready, tested,
> secure, documented, both API and UI where implied. Docs + CHANGELOG update
> with each phase.

## Cross-cutting rules

- **Security is not a phase** — the SECURITY.md 30-area baseline applies to
  every phase; the toll-fraud spec (SEC-002) must ship **with the first
  call-affecting feature (Phase 12 at the latest)**, not with Phase 16.
- **Docs-as-you-build**: DATABASE/API/TELECOM/BILLING/etc. sections move from
  PLANNED→EXISTING as each phase lands; audits re-run at phase boundaries.
- A phase may start before its predecessor is 100% polished, but a phase's
  **gate decisions must be resolved before its build starts**.

## The 20 phases

| # | Phase | Scope (deliverables) | Gate decisions required first | Status |
|---|---|---|---|---|
| 1 | **Application Shell** | Repo scaffold (git + monorepo), stack foundation, CI (lint/typecheck/test/dep-audit/secret-scan), docker dev data plane, `.env.example`, base API + web apps, health endpoints, portal shell (rail/header/⌘K frame) on the design system | ADR-0002 ✔ frontend; ADR-0003 ✔ backend | **Frontend shell SHIPPED** (2b18890); **API scaffold + health SHIPPED** w/ Phase 2 |
| 2 | **Authentication** | argon2id, JWT access + rotating refresh w/ reuse detection, server-side sessions, TOTP MFA + step-up, login/MFA screens, session management UI | — (design locked) | **API IMPLEMENTED 2026-08-27** (e2e pending data-plane run); login/MFA UI screens pending |
| 3 | **Tenant system** | Tenancy model implementation, tenant/customer entities, data-layer isolation (app-scope or RLS) + cross-tenant leak test suite | ✔ ADR-0004 | **IMPLEMENTED 2026-08-27** (e2e pending data-plane run) |
| 4 | **RBAC** | Permission catalogue (seeded), roles, per-route guards (deny-by-default), route↔permission coverage tests, role assignment | ✔ system roles seeded | **IMPLEMENTED 2026-08-27** (custom roles + groups + wildcard grants) |
| 5 | **Design system** | v0.1 spec + reference sheet DONE; this phase = owner approval, then component library implementation (tables, forms, drawers, status, palette) in the chosen stack | ~~Owner approval~~ ✔ 2026-08-26; ADR-0002 | **v0.1 APPROVED** — component library implementation awaits ADR-0002 |
| 6 | **Admin system** | User management, role admin, tenant/customer admin, settings; maker-checker config; impersonation only via dedicated ADR | ADR if impersonation wanted (SEC-007) | Not started |
| 7 | **Audit logging** | Append-only audit table (same-transaction writes), audit trail viewer UI, retention policy | — (design locked) | Not started |
| 8 | **Telecom foundation** | DID lifecycle state-machine engine, carrier-adapter abstraction (one interface), provisioning queue + workers, local↔carrier reconciliation framework | Queue tech (inside ADR-0002) | Not started |
| 9 | **DID** | Inventory (search/filter/order/assign/release), lifecycle UI (table + drawer per design system), idempotent order flow | **Carrier/DID-supply selection** (TELECOM.md UNKNOWN #1) | Not started |
| 10 | **Carriers** | Carrier management module, vaulted credentials (references only), per-carrier adapter implementations, carrier health signals | Carrier contracts; secret store (SEC-006) | Not started |
| 11 | **SIP** | SIP trunk/delivery configuration (if delivery model includes SIP): trunk entities, IP ACLs, credential handling. **Public-IP constraint applies — never behind CDN** | **Delivery-model decision** (TELECOM.md UNKNOWN #2) | Not started |
| 12 | **Routing** | Per-DID routing config (versioned/audited — "what routed at time T"), routing UI, **toll-fraud rails ship here**: spend/velocity/geo limits, balance gates, kill-switch (SEC-002 spec) | Toll-fraud spec written & approved | Not started |
| 13 | **Billing** | Double-entry ledger spine + idempotency guard, wallet OR invoicing per ADR, NRC/MRC charge cycles, reconciliation job + drift alert, ledger drill-down UI | ✔ ADR-0022 (DB-003) | **13-1 ledger foundation TECHNICALLY ACCEPTED (merged, not deployed)** — spine + idempotency guard (13-1B+C, PR #21) and exact money + secure internal posting integration (13-1D+E, PR #22, incl. CI-002 fix) **merged to `main`** (`68d4da2`); post-merge CI green; 13-1F doc closure pending PR merge + final owner acceptance; NOT deployed; wallet/charge-cycles/reconciliation/UI not started |
| 14 | **CDR** | Ingest workers (dedupe by carrier record id), monthly-partitioned storage + automated partition management, CDR viewer + filters + export | CDR source + volume (DB-005) | Not started |
| 15 | **Payments** | Payment rails per ADR (manual/crypto/PSP), signed webhooks + replay dedupe, top-up/settlement flows, compliance posture documented | **Rails ADR (SEC-005)**; AML/KYC ownership | Not started |
| 16 | **NOC** | The operational cockpit: work queues (stuck orders/ports, failed provisioning), system health tiles, **Fraud Center** (limit trips, lock-down), alert → runbook wiring, notification center | Phases 8–14 emitting signals | Not started |
| 17 | **AI** | AI-assisted operations (scope to be defined with owner: e.g. operator copilot, anomaly explanation, support assistant). Claude API; feature toggles; no autonomous money/provisioning actions without step-up confirm | **Owner scope definition** | Not started |
| 18 | **CRM** | Customer relationship layer (scope to be defined: accounts, contacts, support notes/tickets, lead intake) integrated with tenant/billing data | **Owner scope definition** | Not started |
| 19 | **Reporting** | Usage/spend reports, statements, trend analytics (dataviz-consistent), scheduled exports (CSV), per-customer and platform views | Billing + CDR live (13, 14) | Not started |
| 20 | **DevOps/maintenance** | Completes what Phases 1+ started: production deploy pipeline + rollback, monitoring/alerting stack, backup automation + restore drills, DR sign-off, full runbook population, maintenance mode | **Hosting decision**; DR targets sign-off (DB-006) | Not started |

## Dependency spine (critical path)

```
ADR-0002 (stack) ──► 1 Shell ──► 2 Auth ──► 3 Tenants ──► 4 RBAC ──► 6/7 Admin+Audit
Tenancy ADR ────────┘                                     │
Design approval ──► 5 Components ─────────────────────────┤
Carrier selection ──► 8 Telecom foundation ──► 9 DID ──► 10 Carriers ──► 12 Routing*
Delivery-model ADR ──► 11 SIP ────────────────────────────┘            (*toll-fraud rails)
Billing ADR ──► 13 Billing ──► 15 Payments ──► 19 Reporting
CDR source ──► 14 CDR ─────────┘
8–14 signals ──► 16 NOC        17 AI / 18 CRM (scope-gated, parallel-capable)
Hosting ──► 20 DevOps (elements land continuously from Phase 1)
```

## Decisions needed, mapped to the phases they unblock

| Decision | Unblocks | Ref |
|---|---|---|
| Stack (ADR-0002) | 1, 5, 8 | PROJECT_STATE UNKNOWN 1 |
| Tenancy model + isolation mechanism | 3 (and schema design generally) | DB-002 / SEC-001 |
| Roles & personas | 4, 6 | UNKNOWN 3 |
| ~~Design system v0.1 approval~~ ✔ approved 2026-08-26 | 5 | UX-002 |
| DID supply / carrier(s) | 9, 10 | TELECOM UNKNOWN 1 |
| Delivery model (SIP trunk / PSTN / registration) | 11, 12 | TELECOM UNKNOWN 2 |
| Billing model + payment rails | 13, 15 | DB-003 / SEC-005 |
| CDR source + expected volume | 14 | DB-005 |
| Launch market(s) | compliance across 9–15 | TELECOM UNKNOWN 3 |
| Hosting | 1 (CI), 20 | UNKNOWN 7 |
| AI scope · CRM scope | 17 · 18 | new — owner input |
