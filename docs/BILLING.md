# BILLING.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**No billing code, ledger, or payment integration exists.**

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

1. Prepaid wallet vs postpaid invoicing (or both, per customer class)
2. Payment rails: cards/PSP (PCI scope), crypto (AML/KYC), manual bank, UPI
3. Pricing catalogue: DID NRC/MRC, per-minute, SMS, porting fees
4. Settlement currency & multi-currency policy
5. Tax handling per market
