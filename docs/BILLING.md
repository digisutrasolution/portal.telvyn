# BILLING.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**No COMMERCIAL billing exists** — no BillingAccount, Wallet, CreditProfile,
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
- **13-1D — IMPLEMENTED locally, pending owner acceptance (NOT committed).** The
  application integration: the exact **money utility** (`src/billing/money.ts` —
  BigInt micros, strict decimal parsing/serialization, no floats), the typed
  posting contract + **canonical SHA-256 idempotency fingerprint**, the unforgeable
  **TrustedLedgerContext** authorization boundary, and the internal
  **`LedgerPostingService`** that establishes trusted context (transaction-local
  `app.*` GUCs) and invokes `ledger_post`. INTERNAL only — no public endpoint, no
  commercial action, inert until an authorized operation calls it. **Trust limit:**
  the GUCs are caller-settable by the runtime role; this protects the trusted app
  path, it is not RLS (ADR-0005 deferred).
- **13-1E — verification/hardening done (local, pending acceptance).** Trusted-context provenance
  hardened (module-private WeakSet + frozen fields; forgery rejected), deterministic concurrency +
  connection-isolation coverage, uncertain-commit recovery, fresh drift + privilege verification.
  Residual: commercial authorization (which operations/owners may post) is deferred RBAC; the service
  stays inert. **13-1F** (final acceptance) — pending owner review.
- **13-2** (BillingAccount + per-account lock anchor + chart of accounts) — not started.

**No money has moved and no balance exists** — a balanced ledger post never
implies sufficient funds; that is 13-3+.

## Principles — PLANNED (locked by constitution)

- Integer-minor-unit, currency-tagged money — no floats anywhere
- Append-only double-entry ledger; balances DERIVED and reconciled, never
  mutated ad hoc
- Global idempotency guard on every money post
- Every balance movement references its source (order, MRC, CDR, adjustment)

## Components — PROPOSED (shape, once model is decided)

- Chart of accounts: customer liability / revenue / COGS / promo / suspense
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
