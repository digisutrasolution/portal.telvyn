# BILLING.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**No COMMERCIAL billing exists** — no usable BillingAccount (the S3 table is inert), Wallet, CreditProfile,
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
- **13-2B S3 — IMPLEMENTED + VERIFIED on the isolated env; not yet merged.** Inert `BillingAccount`
  database foundation (migration `20261126120000_billing_account_foundation`, `DATABASE.md`): tenant-owned
  (CUSTOMER/RESELLER only), immutable currency/mode/number/lineage, DB floor of the lifecycle (start
  ACTIVE, CLOSED terminal), one default per (tenant, currency), per-tenant open-label uniqueness,
  same-tenant successor lineage. **The runtime role has no access to it**; no endpoint, service, rows,
  ledger link or money movement. Provisioning, locking, reads and the ledger link are S5/S6/S8/S4.

**No money has moved and no balance exists** — a balanced ledger post never
implies sufficient funds; that is 13-3+.

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
