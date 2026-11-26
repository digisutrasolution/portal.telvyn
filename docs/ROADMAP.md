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
| 13 | **Billing** | Double-entry ledger spine + idempotency guard, wallet OR invoicing per ADR, NRC/MRC charge cycles, reconciliation job + drift alert, ledger drill-down UI | ✔ ADR-0022 (DB-003) | **Phase 13 IN PROGRESS.** **13-1 ledger foundation CLOSED AND ACCEPTED (merged, not deployed)** — spine + idempotency guard (13-1B+C, PR #21) and exact money + secure internal posting integration (13-1D+E, PR #22, incl. CI-002 fix) **merged to `main`** (`68d4da2`); 13-1F doc closure merged (PR #23, final baseline `d24a142`); NOT deployed; **13-2A design gate COMPLETE — architecture OWNER-APPROVED 2026-11-26 (ADR-0022 Amendment 5)**; **13-2B implementation NOT STARTED — separate owner authorization required** (see below); **13-2 through 13-9 not implemented** (wallet/charge-cycles/reconciliation/UI not started) |
| 14 | **CDR** | Ingest workers (dedupe by carrier record id), monthly-partitioned storage + automated partition management, CDR viewer + filters + export | CDR source + volume (DB-005) | Not started |
| 15 | **Payments** | Payment rails per ADR (manual/crypto/PSP), signed webhooks + replay dedupe, top-up/settlement flows, compliance posture documented | **Rails ADR (SEC-005)**; AML/KYC ownership | Not started |
| 16 | **NOC** | The operational cockpit: work queues (stuck orders/ports, failed provisioning), system health tiles, **Fraud Center** (limit trips, lock-down), alert → runbook wiring, notification center | Phases 8–14 emitting signals | Not started |
| 17 | **AI** | AI-assisted operations (scope to be defined with owner: e.g. operator copilot, anomaly explanation, support assistant). Claude API; feature toggles; no autonomous money/provisioning actions without step-up confirm | **Owner scope definition** | Not started |
| 18 | **CRM** | Customer relationship layer (scope to be defined: accounts, contacts, support notes/tickets, lead intake) integrated with tenant/billing data | **Owner scope definition** | Not started |
| 19 | **Reporting** | Usage/spend reports, statements, trend analytics (dataviz-consistent), scheduled exports (CSV), per-customer and platform views | Billing + CDR live (13, 14) | Not started |
| 20 | **DevOps/maintenance** | Completes what Phases 1+ started: production deploy pipeline + rollback, monitoring/alerting stack, backup automation + restore drills, DR sign-off, full runbook population, maintenance mode | **Hosting decision**; DR targets sign-off (DB-006) | Not started |

## Phase 13-2A — design-only gate (within Phase 13-2)

**Phase 13-2A: BillingAccount, financial authorization and chart-of-accounts
architecture design.** Status: **COMPLETE — architecture OWNER-APPROVED
2026-11-26**, recorded in **ADR-0022 Amendment 5** (§"Phase 13-2A architecture
decisions"). Design only: no schema, migration, code, privilege, or endpoint
change was made. **Phase 13-2B (implementation) is NOT STARTED and requires
separate explicit owner authorization.** Bound by ADR-0022 (the five owner
decisions, D1–D4, R1–R6 and the Amendment 3 safeguards are not reopened). Phase 13
slice numbering (13-1…13-9) is the billing roadmap, not the historical Phase
12A…12R telecom tracking.

Decisions (summary — the authoritative text is ADR-0022 Amendment 5):

| ID | Design topic | Owner decision (2026-11-26) | Lands |
|---|---|---|---|
| BA-01 | BillingAccount ownership | Non-null, immutable tenant owner; platform access via explicit audited path | 13-2 |
| BA-02 | Customer/account relationships | Many per tenant; unique number; per-tenant label; one default per (tenant, currency) | 13-2 |
| BA-03 | Account provisioning | Platform-only + explicit permission + step-up; atomic, idempotent, same-tx audit; no zero-amount ledger tx | 13-2 |
| BA-04 | Currency boundaries | Immutable currency, enforced on linked ledger accounts | 13-2 |
| BA-05 | Billing mode | Shared table, immutable mode, successor account on change | 13-2 |
| BA-06 | Account lifecycle | ACTIVE / SUSPENDED / CLOSING / CLOSED; start ACTIVE; CLOSING→ACTIVE allowed; CLOSED terminal | 13-2 |
| BA-07 | Account-level locking | Ordered `FOR UPDATE` before ledger idempotency; bounded outer retry | 13-2 |
| BA-08 | Financial RBAC | Wildcard-excluded high-risk permissions; maker-checker; retire `wallet.credit`; MFA required; no auto-grants | 13-2 |
| BA-09 | Authorized ledger-context minting | Private `FinancialAuthorizationService` + architecture test + lint | Before 13-3 |
| BA-10 | Chart of accounts (**OB-1 resolved**) | `LedgerAccount.billingAccountId` + `billing.ledger_account_open` | Foundation 13-2 · prepaid before 13-3 · postpaid before 13-4 |
| BA-11 | Posting-matrix boundaries | Framework only; entries approved per slice | Before 13-3 / 13-4 |
| BA-12 | Financial read visibility | SECURITY DEFINER read functions; masked projections | Metadata 13-2 · balances before 13-3 |
| BA-13 | Platform vs tenant boundaries | Tenant-scoped; column-level UPDATE, no DELETE; RLS still deferred | 13-2 |
| BA-14 | Financial audit requirements | Dedicated append-only table, same transaction, fail closed | 13-2 |
| BA-15 | Financial step-up authentication | Server-side single-use grant + TOTP replay guard | 13-2 |

**Resolved boundary decisions:**

- **OB-1 — Chart-of-accounts timing — RESOLVED (Amendment 5).** 13-2A: COA
  architecture; 13-2: COA foundation (no platform accounts, no postings); before
  13-3: prepaid platform accounts + prepaid posting matrix; before 13-4: postpaid
  receivable accounts + postpaid posting matrix.
- **OB-2 — Financial-authorization timing — RESOLVED (Amendment 5).**
  Dependency-based gates supersede "before 13-9": each financial control (RBAC,
  audit, step-up, read visibility, minting, locking) must exist before the
  **first** implementation that depends on it. Consequence: **13-2 includes
  financial RBAC, same-transaction financial audit and step-up MFA.**

**Owner values still open** (not decided by 13-2A): account-number format; usage
→ account selection (13-5); lock/transaction timeouts and retry count; step-up
TTLs and freshness; dual-control thresholds; refund vs forfeit of prepaid funds at
closure; export rules; tenant-owned receivable interpretation; reseller
sub-customer billing (tenant-hierarchy ADR); tenant self-service provisioning
(separate architecture approval). Separate follow-up: convert the fraud plane's
money-as-`number` (`completeCall`) to BigInt before any billing↔fraud integration.

Out of 13-2A (later billing slices / phases, per ADR-0022): wallet projections
(13-3), CreditProfile and credit limits/approval (13-4), reservation TTL defaults
and exposure limits (13-5), late-CDR settlement and reconciliation (13-6), billing
cycles, terms, tax, invoice numbering, overdue and suspension (13-7), payment
posting (13-8), refunds/chargebacks (partly Phase 15), rating and rounding (Phase 14).

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
