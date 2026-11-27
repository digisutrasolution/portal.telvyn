# BILLING.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**No COMMERCIAL billing exists** — no usable BillingAccount (the S3 table and the S4 chart-of-accounts link are inert), Wallet, CreditProfile,
UsageReservation, invoicing, payments, pricing, or customer-facing billing
action. Those are later, owner-gated slices.

**The billing model is HYBRID** prepaid wallet + postpaid credit — **ADR-0022**
(Accepted, resolves DB-003); technical design in `LEDGER_FOUNDATION.md`.

**Phase 13-1 progress:**
- **13-1B+C — MERGED (`main`, PR #21).** The database ledger foundation: the four
  append-only, double-entry tables (`LedgerAccount`/`LedgerTransaction`/`LedgerLeg`/
  `IdempotencyKey`), deferred balancing/immutability triggers, the restricted
  `billing.ledger_post` SECURITY DEFINER function, and the least-privilege role
  model. Verified; NOT deployed to production.
- **13-1D — MERGED (`main`, PR #22).** The
  application integration: the exact **money utility** (`src/billing/money.ts` —
  BigInt micros, strict decimal parsing/serialization, no floats), the typed
  posting contract + **canonical SHA-256 idempotency fingerprint**, the unforgeable
  **TrustedLedgerContext** authorization boundary, and the internal
  **`LedgerPostingService`** that establishes trusted context (transaction-local
  `app.*` GUCs) and invokes `ledger_post`. INTERNAL only — no public endpoint, no
  commercial action, inert until an authorized operation calls it. **Trust limit:**
  the GUCs are caller-settable by the runtime role; this protects the trusted app
  path, it is not RLS (ADR-0005 deferred).
- **13-1E — MERGED (`main`, PR #22).** Trusted-context provenance
  hardened (module-private WeakSet + frozen fields; forgery rejected), deterministic concurrency +
  connection-isolation coverage, uncertain-commit recovery, fresh drift + privilege verification.
  Residual: commercial authorization (which operations/owners may post) is deferred RBAC; the service
  stays inert.
- **CI-002 — MERGED (`main`, PR #22, `0b0d33e`).** Test-only fix: the F04 concurrency test now builds its
  single-connection DB URL with the WHATWG `URL` API (exactly one `connection_limit=1`, query-free or not;
  fail-closed), with six colocated portability tests. No ledger/schema/privilege/CI change.
- **Phase 13-1 was technically accepted** — merged to `main` (`68d4da2`); post-merge CI `45684728547` green
  (**API 619 passed / 2 skipped**, web 257, build 19/19).
- **13-1F — MERGED (`main`, PR #23, merge `d24a142`).** **Phase 13-1 is CLOSED AND ACCEPTED**; final
  accepted baseline `d24a142`. NOT deployed to production.
- **13-2A — COMPLETE (2026-11-26, design only).** The commercial billing architecture (BA-01..BA-15,
  OB-1, OB-2) is **OWNER-APPROVED** and recorded in **ADR-0022 Amendment 5**: tenant-owned
  BillingAccount with immutable currency/mode, platform-only step-up provisioning, ACTIVE/SUSPENDED/
  CLOSING/CLOSED lifecycle, D3 account lock, wildcard-excluded financial RBAC with maker-checker,
  private ledger-context minting, chart of accounts via `LedgerAccount.billingAccountId`, restricted
  read functions, append-only same-transaction financial audit, and step-up MFA. No code or schema.
- **13-2** (BillingAccount + per-account lock anchor + chart-of-accounts foundation, now also financial
  RBAC, financial audit and step-up per the OB-2 gates) — **13-2B implementation IN PROGRESS**; slice
  register S1–S9 and order S3 → S1 → S2 → S4 → S5 → S6 → S8 → S7 → S9 OWNER-APPROVED (`ROADMAP.md`),
  each slice separately authorized.
- **13-2B S3 — MERGED (`main`, PR #27, merge `6fea9fa`); NOT deployed.** Inert `BillingAccount`
  database foundation (migration `20261126120000_billing_account_foundation`, `DATABASE.md`): tenant-owned
  (CUSTOMER/RESELLER only), immutable currency/mode/number/lineage, DB floor of the lifecycle (start
  ACTIVE, CLOSED terminal), one default per (tenant, currency), per-tenant open-label uniqueness,
  same-tenant successor lineage. **The runtime role has no access to it**; no endpoint, service, rows,
  ledger link or money movement. Provisioning, locking, reads and the ledger link are S5/S6/S8/S4.
- **13-2B S1 — MERGED (`main`, PR #28, merge `032ee95`); NOT deployed.** Financial authorization
  foundation (BA-08/BA-15; owner decisions G1–G4): `wildcardExcluded` permission flag (never covered by
  `*`/`x.*`, effective only with MFA, assignment fails closed in S1 — no key flagged yet), `wallet.credit`
  retired, TOTP replay guard, and the inert server-side `StepUpGrant` (300 s, single-use, bound to
  user/session/tenant/purpose). No endpoint, no financial permission granted to any role, no money
  movement. Maker-checker (13-3/13-4), the financial audit write (S2) and minting (S7) are not in S1.
- **13-2B S2 — MERGED (`main`, PR #31, merge `fd0c3d1`); inert foundation, NOT active commercial billing; NOT deployed.** Financial audit foundation
  (BA-14; owner decisions F1–F7): dedicated append-only `FinancialAuditEvent` table and the internal
  `FinancialAuditWriter`, which writes only through the caller's transaction so audit and change commit
  or roll back together (fail closed). Inert: the operation catalog is empty until S5. An audit row is
  attribution evidence — never a ledger entry and never commercial authorization. Denied-attempt
  recording, idempotent-replay audit suppression and audit reads are S5/S8 work.
- **13-2B S4 — IMPLEMENTED + VERIFIED (disposable `local-verify` env + CI); inert foundation, NOT active
  commercial billing; NOT deployed.** Chart-of-accounts foundation (BA-10; owner decisions D1–D6):
  `LedgerAccount.billingAccountId` and the restricted `billing.ledger_account_open`. Exactly **one** taxonomy,
  `customer_funds` (LIABILITY, normal balance CREDIT), for PREPAID BillingAccounts only — customer funds held
  by the platform. Ledger signs are unchanged (debit positive, credit negative): a funded `customer_funds`
  account carries a **negative** ledger balance, and the customer-facing available balance (13-3) is a
  separate, derived figure, never this sign read raw. Opening posts nothing. Not the complete commercial chart
  of accounts: postpaid receivables (before 13-4) and platform cash/clearing/revenue/settlement accounts
  (before 13-3/13-4 postings) are still to be designed and accepted. The runtime cannot open accounts until S5.

**No money has moved and no balance exists** — a balanced ledger post never
implies sufficient funds; that is 13-3+.

### S2 review registers — two-way reconciliation (2026-11-28)

Two registers reviewed the S2 release independently: the **implementation register** (M-R01..M-R10, from the
S2 implementation/release reports) and the newer **owner review register** (X-R01..X-R10). Neither is
overwritten; every item of each maps below. Nothing here closes an outstanding financial security decision.

| Owner item | Implementation item(s) | Status | Gate |
|---|---|---|---|
| X-R01 FA004 tenant attribution | M-R03 (FA004/FA005 stricter than the F-text) | DB check in force (fail closed); **owner ratification pending** | before S5 |
| X-R02 FA005 semantics | M-R03, M-R04 (owner checked, not expiry/consumption) | OPEN — the S5 caller must consume the grant in the same transaction | S5 |
| X-R03 runtime SELECT before S8 | M-R08 (no audit read API) | OPEN — F6 grants SELECT; with no RLS any runtime code could read every tenant's audit rows. Decide in S8 whether to narrow SELECT to SECURITY DEFINER read functions | S8 (RLS: ADR-0005) |
| X-R04 sensitive values / denylist bypass | M-R09 (key names only, not values) | OPEN — value-level checks or typed per-operation metadata schemas needed before the first catalog operation | S5 |
| X-R05 transaction-client provenance | — (new) | OPEN — the writer's base-client refusal is structural (`$transaction` absent); it cannot prove the client is a live interactive transaction. S5 callers must pass the Prisma interactive-transaction client only | S5 |
| X-R06 linked ledger transaction ownership | M-R07 | OPEN — needs ledger read access the runtime lacks | S7 |
| X-R07 fresh migration replay | M-R10 | **CLOSED** — CI replays every migration into an empty database (S2: 20; S4: 21) | — |
| X-R08 actual skipped-test reasons | — (reported "not confirmed" in S2) | **CLOSED** (SOURCE-INSPECTED 2026-11-28): `e2e-lease-drill` runs only with `TELVYN_E2E_LEASE_DRILL=loss\|setup-fail` on `local-verify`; `telecom-engine-live` and `telecom-engine-apply-live` run only with `ENGINE_LIVE_MTLS_DIR` (live Kamailio + mTLS). 3 files / 3 tests skipped by design | — |
| X-R09 recovery-code policy | (S1 carried gate) | OPEN — S1 excludes recovery codes from financial step-up; **owner ratification pending** | before S5 |
| X-R10 role escalation | (S1 carried gate) | RESOLVED by P1 (2026-11-28) — `setMemberRoles` locked, authority re-derived, no delegation beyond held permissions, protected/last owner, self-change refused (`docs/SECURITY.md`) | before S5 |
| — | M-R01 `idempotencyKey` format/length | OPEN (F7) | S5 |
| — | M-R02 IP / user-agent retention | OPEN — owner decision | owner |
| — | M-R05 denied-attempt writer | OPEN (F2) | S5 |
| — | M-R06 replay audit suppression | OPEN (F7) | S5 |

## Principles — PLANNED (locked by constitution)

- Integer-minor-unit, currency-tagged money — no floats anywhere
- Append-only double-entry ledger; balances DERIVED and reconciled, never
  mutated ad hoc
- Global idempotency guard on every money post
- Every balance movement references its source (order, MRC, CDR, adjustment)

## Components — PROPOSED (shape, once model is decided)

- Chart of accounts: customer liability / revenue / COGS / promo / suspense — architecture
  decided (ADR-0022 Amendment 5, BA-10); per-operation accounting treatment still open
- Charge engine: DID NRC + MRC cycles; usage rating if per-minute billing is in scope
- Statement/invoice generation
- Low-balance & suspension automation with grace policies

## UNKNOWN (owner decisions)

1. ~~Prepaid wallet vs postpaid invoicing (or both, per customer class)~~ —
   **RESOLVED: HYBRID (both), mode per BillingAccount (ADR-0022).**
2. Payment rails: cards/PSP (PCI scope), crypto (AML/KYC), manual bank, UPI
3. Pricing catalogue: DID NRC/MRC, per-minute, SMS, porting fees
4. Settlement currency & multi-currency policy
5. Tax handling per market
