# ADR-0022 — Hybrid prepaid wallet & postpaid credit billing

- Status: **Accepted** (2026-11-24)
- Supersedes: none
- Resolves gate: **DB-003** (billing model — `DATABASE.md`, `BILLING.md` UNKNOWN #1)
- Design document: **`docs/LEDGER_FOUNDATION.md`** (the implementation-level
  technical design for Slice 13-1)
- Related: ADR-0003 (PostgreSQL 18 + Prisma — resolves DB-004), ADR-0004 (tenant
  isolation), ADR-0005 (RLS deferred), ADR-0008 (dual-nature system/tenant
  ownership), ADR-0010 (audit model boundary), ADR-0021 (fraud-event foundation —
  fraud/settlement separation), SEC-005 (payment rails, Phase 15), DB-005 (CDR
  volume/partitioning, Phase 14)
- Amendments:
  - **Amendment 1 (2026-11-24)** — applied the technical review (F1–F6) and
    recorded technical-architecture decisions **D1–D4**.
  - **Amendment 2 (2026-11-24)** — **D1–D4 ratified by the owner**; recorded the
    ledger-foundation finalization **R1–R6** (§"Ledger foundation finalization"),
    the DB-004 resolution, and the restricted posting / role model.
  - **Amendment 3 (2026-11-24)** — **final acceptance.** Added the SECURITY
    DEFINER security model, ledger read-isolation, and the resolved idempotency
    insertion sequence (§"Final acceptance safeguards"); referenced
    `docs/LEDGER_FOUNDATION.md`; **status Proposed → Accepted.**

> **Status note.** **Accepted.** The **five owner billing decisions**
> (§"Owner decision") are **OWNER-APPROVED**; the technical architecture (**D1–D4**
> ratified, **LF-01–LF-10** and **R1–R6** accepted) is accepted. **Acceptance does
> NOT authorize implementation** — Slice 13-1 begins only on separate explicit
> owner authorization, and several commercial/accounting policies remain open
> (§"Open decisions"). Full implementation detail: `docs/LEDGER_FOUNDATION.md`.

## Context

`ROADMAP.md` Phase 13 (Billing) is gated on **DB-003** — the billing-model
decision. `BILLING.md` records the current state plainly: *"No billing code,
ledger, or payment integration exists."* The schema contains no billing, wallet,
ledger, invoice, payment, or CDR model; `/billing` and `/cdrs` are unbuilt web
placeholders; the RBAC group `billing` (`wallet.read`, `wallet.credit`,
`cdr.read`) is declared only "for role stability."

What **does** exist and constrains this decision (all verified in-repo):

- **Money convention** — integer **micros** (`BigInt`), currency-tagged, never
  float; `Currency` enum = USD/EUR/GBP/INR/AUD/CAD/JPY.
- **Constitution-locked billing principles** (`BILLING.md`, `DATABASE.md`) —
  append-only **double-entry ledger**; balances **derived** and reconciled,
  never a mutated balance column as source of truth; a **global, non-partitioned
  idempotency** guard on every money post; every movement references its source;
  a DB-level **Σ legs = 0** guard; the ledger is **never partitioned**.
- **Dual-nature ownership (ADR-0008)** — `Carrier`, `TelecomCredential` and other
  telecom models use a **nullable `tenantId`** (null = platform), are **excluded
  from `TENANT_SCOPED_MODELS`**, and are scoped explicitly via `systemOrTenantWhere`
  / `authorizeDualNatureWrite` / `ownerTenantIdForCreate`.
- **Reservation pattern** — `SpendReservation` (ADR-0021 / slice 12R-6):
  `reserve`/`settle`/`release`/`expireDue`, idempotent, race-safe, fail-closed,
  uniqueness `@@unique([tenantId, idempotencyKey])`. It reserves against **fraud
  limits** (Redis gauges + a Postgres row), not a wallet balance or ledger.
- **Call-authorization hook** — `CallAuthorizationService` (slice 12R-8):
  **policy-only, with no wallet/balance gate**, explicitly deferred to this
  decision. Its concurrency check uses **Redis gauges** (correct for fraud counts).
- **Isolation & audit** — ADR-0004 tenant scoping; ADR-0010 audit boundary.
- **Async** — a transactional **outbox** pattern (`EmailOutbox`); no in-process
  job-queue infrastructure. **Migrations** are Prisma `migration.sql` (raw SQL).

The problem this ADR resolves: choose the billing model so the ledger spine,
wallet/credit tables, reservation pattern, and suspension logic that DB-003 said
were blocked can be designed — without ad-hoc money columns, which the
constitution forbids.

## Owner decision

The owner has selected **HYBRID** billing: Telvyn supports **PREPAID** (wallet)
**and** **POSTPAID** (credit), on one shared billing foundation, with the billing
mode assigned at **billing-account** level, and separate prepaid/postpaid
policies and lifecycles. The owner has further approved the following five
decisions **exactly as stated** (these are **OWNER-APPROVED**):

1. **Multiple billing accounts.** A customer may have multiple billing accounts.
   Accounts may be separated by currency, service, or commercial requirement.
2. **Currency policy.** Each billing account has exactly one currency. A ledger
   transaction cannot mix currencies. Cross-currency activity requires a
   separately defined conversion transaction/process.
3. **Reservation policy.** Reservation TTL is **configurable** (no universal
   hard-coded six-hour TTL); per-account exposure limits apply; the reservation
   lifecycle and expiry handling are explicit; reconciliation is supported.
4. **Negative wallet balance.** Ordinary prepaid wallet operations must not
   create a negative available balance. Corrections must use **authorized
   compensating ledger transactions**. Negative balances are never silently
   permitted.
5. **Billing-mode transition.** An existing billing account is **not** changed
   from PREPAID to POSTPAID (or vice versa) in place. A **new** billing account
   is created for the new mode; the previous account's history is preserved;
   outstanding obligations and reservations are resolved before closure.

## Decision drivers

- Financial integrity above features (constitution): correct money, routing, and
  tenant data before capability.
- Reuse of proven Telvyn primitives (money convention, the 12R reserve/settle
  pattern, tenant scoping, audit) rather than a new framework — **without**
  importing fraud-plane concurrency mechanisms (Redis gauges) as financial
  authority.
- Continuity with the toll-fraud rails: billing authorization composes with the
  existing `CallAuthorizationService`, it does not replace it.
- A single shared ledger so hybrid does not mean two duplicated financial
  subsystems with their own reconciliation and drift risk.

## Approved architecture (PROPOSED)

One **billing core** with a mode discriminator on the account; both modes post to
the **same** append-only double-entry ledger. The following concepts are
distinguished (none exists in the repository today):

- **BillingAccount** — the billing identity, **tenant-owned** (ADR-0004; in
  `TENANT_SCOPED_MODELS`). A Telvyn "customer" is a `Tenant` of type CUSTOMER or
  RESELLER; there is no separate customer entity. Carries `mode`
  (PREPAID | POSTPAID), exactly one `currency`, and a lifecycle status
  (ACTIVE / SUSPENDED / CLOSED). Per decision 1 a customer may hold several; per
  decision 2 each is single-currency. **The `BillingAccount` row is the
  account-lock anchor (D3).**
- **Wallet** (prepaid) / **CreditProfile** (postpaid) — tenant-owned projections
  of a prepaid account's funds or a postpaid account's credit; **derived** from
  the ledger + reservations, never an independent source of truth (D2).
- **LedgerAccount** — a chart-of-accounts node. **Dual-nature (ADR-0008), not
  ADR-0004 tenant-scoped:** `tenantId` is **nullable** — **customer-liability
  accounts are tenant-owned** (`tenantId` set); **revenue / COGS / promo /
  suspense are platform-owned** (`tenantId = null`). Excluded from
  `TENANT_SCOPED_MODELS`; scoped explicitly. Carries explicit ownership and
  `currency`.
- **LedgerTransaction** — an atomic, **immutable** financial event grouping legs;
  carries its idempotency key and a reference to its source. **Ownership
  consistency (D1):** an ordinary customer billing transaction may include **the
  relevant tenant's** accounts **and** platform accounts; it **must not** include
  **another** tenant's accounts. This is enforced at the service layer and, where
  feasible, at the database layer (a tenant-consistency check over the legs'
  owners — see "remaining schema-level enforcement decisions" below).
- **LedgerLeg** — a signed posting against a `LedgerAccount`. **Dual-nature**
  (inherits the account's ownership). Posted legs are **immutable**. A posted
  transaction's legs **sum to zero** and there are **at least two non-zero legs**
  (F6); all legs share one currency (decision 2).
- **UsageReservation** — **[D2] an off-ledger hold** (tenant-owned) against wallet
  funds (prepaid) or credit headroom (postpaid) for an in-flight call. It touches
  **no** `LedgerLeg`; **only settlement posts to the ledger.** Idempotent,
  concurrency-safe (D3), **configurable** TTL (decision 3), explicit **atomic**
  lifecycle active → settled / released / expired. **Distinct from** the fraud
  `SpendReservation` (ADR-0021), which holds against fraud limits and never
  touches money (see "Fraud ↔ billing coordination").
- **UsageCharge** — a settled usage cost, traceable to its **CDR and rating
  inputs** (provenance). Depends on Phase 14 (CDR/rating); interface only here.
- **Invoice** (+ invoice lines) — postpaid billing-cycle statement. Tenant-owned.
- **Payment** (+ allocation) — received funds and their allocation to wallet
  credit (prepaid) or invoices (postpaid). Tenant-owned. Provider = Phase 15.
- **BillingAdjustment** — an administrative credit/debit posted as a
  **compensating** ledger transaction, with an **authorized actor + reason**
  (never an edit to history).
- **IdempotencyKey** — **[D4]** the single, **non-time-partitioned** guard for
  financial operations. "Global / non-partitioned" means **one table, never
  time-partitioned — not that keys are globally unique** (see D4 for the scope,
  per-operation granularity, platform namespace, and NULL-uniqueness treatment).

### D1 — ownership & visibility policy (PROPOSED)

- **LedgerAccount:** tenant-owned (customer liability) or platform-owned
  (revenue/COGS/promo/suspense). Tenant-facing queries return **only** legs on
  accounts the tenant owns and **never** expose platform account identities,
  balances, or confidential metadata.
- **LedgerTransaction / LedgerLeg:** scoped by the ownership of the accounts they
  touch; a transaction spans at most one tenant plus platform accounts.
- **IdempotencyKey:** tenant-scoped uniqueness with an **explicit platform
  namespace** for platform-owned operations (D4).
- **[Not sufficient alone] Financial authorization** must **not** rely solely on
  the generic ADR-0008 write helpers (`authorizeDualNatureWrite`). A posting
  service enforces the stronger financial rules (one-tenant-per-transaction,
  currency and ownership consistency, authorized actor for adjustments) above the
  generic helper, with DB-enforced ownership consistency where feasible.
- **Remaining schema-level enforcement decisions (before 13-1):** whether
  one-tenant-per-transaction is enforced by a DB check/trigger (feasible if legs
  carry a denormalized owner) or by the posting service only; how a transaction's
  owning tenant is represented for scoped reads (denormalized owner column vs a
  join through accounts); the platform-namespace sentinel for `IdempotencyKey`.

## Reservation accounting (D2, PROPOSED)

- A `UsageReservation` is an **off-ledger hold**; the ledger records only real
  money movements (funding credit, settled usage, adjustments). This keeps the
  ledger free of reserve/release churn and matches the `SpendReservation`
  precedent.
- **Three distinct quantities, never conflated:**
  - **PREPAID:** *posted wallet balance* (Σ settled legs on the account's funds);
    *active reserved amount* (Σ open reservations); **available wallet balance =
    posted wallet balance − active reserved amount.**
  - **POSTPAID:** *approved credit limit*; *outstanding financial exposure* =
    **invoiced-unpaid usage + uninvoiced posted usage** (each counted once —
    never omitted or double-counted as usage moves from uninvoiced to invoiced);
    *active reserved exposure* (Σ open reservations); **available credit headroom
    = credit limit − (outstanding exposure + active reserved exposure).**
- **Requirements:** atomic reservation state transitions; configurable TTL and
  per-account exposure limits; **idempotent** reserve / settle / release / expire;
  settlement posts the actual cost to the ledger **and** closes the hold in the
  **same** DB transaction; reconciliation asserts **both** the ledger projection
  and the reservation set, with **no double-counted or orphaned reservations.**

## Prepaid lifecycle (PROPOSED)

Verified funding (a confirmed payment) → ledger **credit** → posted balance ↑ →
usage **reservation** against **available wallet balance** (never into the
negative, decision 4; D2/D3) → rating + **settlement** from the rated CDR (ledger
debit) + hold closure, atomically → **release** of any unused reservation →
low-balance alert / insufficient-funds handling → reconciliation. Payment is
verified **before** any wallet credit is posted. Late settlement is governed by
"Lifecycle coordination" (F5).

## Postpaid lifecycle (PROPOSED)

Approved **credit profile** (limit) → authorization against **available credit
headroom** (D2) → usage **posting** (accrual to the ledger) → **billing cycle**
close → **invoice** + lines → **payment allocation** → overdue policy → credit
**suspension** → restoration on settlement. Cycle length, terms, overdue
thresholds, tax, and invoice numbering are **open** (§"Open decisions").

## Call-authorization integration (PROPOSED)

- **Integration point.** Billing authorization is a **balance/credit gate
  composed into the existing `CallAuthorizationService`** (slice 12R-8), which
  today is policy-only. It does not replace the fraud decision; it adds a
  billing-headroom check and places a **billing `UsageReservation`** on ALLOW.
  **This ADR does not modify `CallAuthorizationService`.**
- **DB-authoritative (D3).** The authoritative available-balance (prepaid) and
  available-credit (postpaid) check reads the account's funds position **under a
  `SELECT … FOR UPDATE` row lock on the `BillingAccount` anchor**, within the
  authorization transaction, and inserts the `UsageReservation` in that same
  transaction. **Redis is never the financial authority.**
- **Distinct from fraud.** The fraud `SpendReservation` (holds against fraud
  limits; Redis gauge + Postgres row; no ledger) and the billing `UsageReservation`
  (holds against money; Postgres; settles to the ledger) are **separate** records
  and concerns, preserving the ADR-0021 fraud/settlement boundary.
- **Fail-closed.** If the authoritative billing state cannot be read, authorization
  **denies**, consistent with the toll-fraud path.
- The **live call path is not activated or modified** by this ADR. Engine
  config-apply does not constitute live SIP/RTP charging.

## Financial concurrency (D3, PROPOSED)

- **Primary protocol: PostgreSQL row-level locking** — `SELECT … FOR UPDATE` on
  the `BillingAccount` row (the account-lock anchor), or an explicitly approved
  equivalent, acquired **before** reading the authoritative position; all checks
  and state changes are performed **atomically** within that transaction. **Redis
  must never be the financial authority** (any Redis figure is a non-authoritative
  cache only).
- **Every funds/exposure-affecting operation** participates in this protocol:
  wallet funding, wallet debit, financial adjustment, usage reservation,
  settlement, reservation release, reservation expiry, credit-limit change,
  payment allocation affecting exposure, and billing-account closure.
- **Isolation & staleness.** The isolation level is compatible with the locking
  protocol (row lock under READ COMMITTED, or SERIALIZABLE where chosen); no stale
  transaction snapshot may bypass an available-balance or exposure check.
- **Multi-account operations** (e.g. inter-account transfer) acquire locks in a
  **deterministic order** (e.g. by `accountId`) to bound deadlock risk. **This
  design does not claim to be deadlock-free**; it uses **bounded retry** with
  backoff and safely handles PostgreSQL **`40001` (serialization_failure)** and
  **`40P01` (deadlock_detected)**, preserving idempotency across retries (D4) so a
  retry never double-posts, and **failing closed** when an authoritative check
  cannot run.
- **No lock-sharding** that would weaken the per-account financial invariant is
  proposed here; any future change to the locking strategy requires **separate
  architecture review**.

## Financial idempotency (D4, PROPOSED)

- **One global, non-time-partitioned `IdempotencyKey` table.** Uniqueness is
  **tenant-scoped per operation** `(tenantId, operation, key)`, matching the
  `SpendReservation` precedent `@@unique([tenantId, idempotencyKey])`. Platform-
  owned operations use an **explicit platform namespace** (a non-null sentinel) —
  **a nullable `tenantId` combined with an ordinary unique constraint does NOT
  provide platform-level idempotency, because PostgreSQL treats NULLs as distinct
  in a unique index**; a non-null platform namespace (or a partial unique index)
  is required so platform operations are actually deduplicated.
- **Per-operation identity.** Distinct operation categories — `reserve`, `settle`,
  `release`, `expire`, `fund`, `adjust`, `refund`, `reverse`, `payment-post`,
  `payment-allocate` — each produce a distinct key, so a single call's reserve /
  settle / release cannot alias. The key format accounts for the **real uniqueness
  scope** of `callKey` and external event IDs (a `callKey` is not guaranteed
  unique across all time; external/provider event IDs are namespaced by source).
- **Payload fingerprinting.** Each record stores a **canonical request fingerprint
  (payload hash)**. **Same key + same request → returns the original result;
  same key + different request → is rejected** (a conflict, never a silent
  overwrite). Concurrent duplicates cannot double-post.
- **Atomicity & recovery.** The idempotency record and the financial effect are
  committed **atomically in the same DB transaction**. Recovery after a process
  crash is explicit (the committed idempotency record makes a retry a no-op; an
  uncommitted attempt leaves no effect). **Financial idempotency records must not
  expire** in a way that would permit duplicate historical posting (no TTL
  eviction of money-post keys — unlike the fraud-alert throttle).

## Financial invariants (PROPOSED)

1. Ledger history is **immutable** (no update/delete of posted transactions/legs).
2. Corrections are **compensating** transactions, never edits.
3. Postings are **atomic** (all legs in one DB transaction).
4. Money operations are **idempotent** via the `IdempotencyKey` guard (D4), with
   payload-fingerprint conflict detection.
5. **Currency is explicit**; all legs of a transaction share one currency
   (decision 2).
6. Money is **integer** micros; **no floating-point** arithmetic; integer
   precision and **overflow handling** are defined (bounded `BIGINT` micros).
7. Concurrent authorization **never** overspends a wallet or exceeds credit
   exposure (D3).
8. **Projections are reconcilable:** posted ledger balance = Σ settled legs; and
   available balance = ledger balance − active reservations, with **no orphaned
   or double-counted holds** (reconciliation job + drift alert over **both** the
   ledger and the reservation set).
9. **Payment is verified before** a financial credit is posted.
10. **Tenant isolation** on every billing operation (ADR-0004 for tenant-owned
    models; **ADR-0008 dual-nature** for the ledger), with service-level financial
    authorization above the generic helpers (D1).
11. Every adjustment carries an **authorized actor (or trusted system identity)
    and a reason** (ADR-0010 audit).
12. Every usage charge is **traceable to its CDR and rating inputs**.
13. A posted transaction has **≥ 2 non-zero legs** and **Σ legs = 0**, with
    valid account references and ownership consistency (F6).

Each invariant is testable: immutability / balance / ≥2-legs / currency /
ownership via DB-constraint & trigger tests; atomicity via partial-failure
rollback tests; idempotency & no-overspend via concurrent duplicate / parallel-
authorization tests (the 12R-8 e2e is the structural template, **not** its Redis
mechanism); reconciliation via cache-vs-ledger + reservation assertions; isolation
via cross-tenant 404 tests.

## Database-level financial integrity (F6, PROPOSED)

Mandatory DB-level enforcement — **application validation alone is insufficient**:

- Atomic posting; balanced double-entry (**Σ legs = 0**) with **≥ 2 non-zero
  legs**; currency consistency; valid `LedgerAccount` references; ownership
  consistency; immutable posted transactions/legs; corrections via compensating
  transactions; idempotent posting; no floating-point; defined integer precision
  and overflow handling.
- **Debit/credit sign convention and the generic ledger posting contract are
  defined before slice 13-1** (the specific per-operation posting matrix is a
  13-3+ decision).
- **Zero-sum validation operates at the correct transaction boundary.** Because
  legs are inserted across multiple statements within one transaction, evaluate a
  **deferred constraint trigger** (`DEFERRABLE INITIALLY DEFERRED`, checked at
  `COMMIT`) or another DB-enforced atomic-posting mechanism, rather than a
  per-statement check.
- **Migration mechanics:** Prisma `migration.sql` supports custom SQL, so the
  trigger/function can be created in an explicit migration. However, such objects
  are **not represented in `schema.prisma`**, so Prisma's schema-diff does not
  manage them; **explicit SQL migrations plus drift checks are required**, and a
  deploy-time existence/validation check confirms the trigger before the ledger
  goes live. **`prisma db push` is prohibited** for managed billing databases that
  carry these custom financial constraints. (This ADR does **not** claim `db push`
  necessarily removes every unmanaged trigger; that behaviour is unverified here
  and is immaterial given the prohibition.)
- No migration is created or executed by this ADR.

## Lifecycle coordination (F5, PROPOSED)

### Late rated CDR after reservation expiry

A rated CDR may arrive **after** its `UsageReservation` expired/released (funds
returned). The call really happened, so the **rated usage obligation must be
preserved** — but **decision 4 holds: ordinary operations must not create a
negative available wallet balance.** Therefore:

- Preserve the legitimate rated usage record; **never silently discard** a valid
  CDR charge.
- Detect **settlement-after-expiry** and detect **insufficient funds** during
  late settlement.
- When funds are insufficient, **record an explicit settlement exception** rather
  than silently debiting the wallet negative or silently creating unauthorized
  prepaid debt.
- Support reconciliation and **controlled recovery**; **prevent duplicate
  collection** (idempotency, D4); apply appropriate **further-authorization
  restrictions** (e.g. gate or suspend further spend pending resolution).
- **Distinguish** four states and never conflate them: **rated usage obligation**
  (owed), **successfully collected charge** (a settled wallet debit), **uncollected
  or disputed charge**, and **settlement exception**. **An uncollected charge is
  never represented as a successfully collected wallet debit.**

**The precise accounting treatment, recovery policy, and any exceptional-debt
authorization remain OPEN** until explicitly approved (§"Open decisions").

### Fraud ↔ billing reservation coordination

A call places **two** holds: the fraud `SpendReservation` (12R-8; Redis gauge +
Postgres row) and the billing `UsageReservation` (Postgres; this ADR). They stay
**separate** (ADR-0021 boundary). Coordination is an **explicit recoverable
workflow, not an atomic lockstep** — there is **no cross-system (Redis +
PostgreSQL) atomic transaction**, and none is claimed. The workflow:

- **Composition order:** the fraud decision runs first; on fraud-ALLOW the billing
  gate runs and places the billing hold.
- **Correlation:** both holds carry the call's correlation id (`callKey`).
- **Idempotent recovery:** each hold is independently idempotent (D4) so retries
  never double-hold.
- **Partial failure / crash:** if the billing hold fails after the fraud hold is
  taken, the fraud hold is **compensated** best-effort; if compensation is missed
  (crash), the fraud hold is **swept by its TTL** (12R-9 pattern) and the mismatch
  is caught by **reconciliation** — reconciliation is the backstop, not a 2-phase
  commit.
- **Expiry coordination & reconciliation:** both hold types are swept on expiry
  and reconciled; neither leaves an orphaned money effect (billing holds are
  off-ledger until settlement).

## Phase boundaries

- **Phase 13 (this ADR's scope):** billing foundation — ledger, wallet, credit,
  authorization gate, NRC/MRC (DID-lifecycle) charging.
- **Phase 14:** CDR ingestion + rating (gate DB-005). Usage settlement actuals
  depend on it; the interface is defined here, the pipeline is not.
- **Phase 15:** payment-provider integrations (gate SEC-005). Payment posting
  interface is defined here; providers are not built here.

These roadmap phases are **not** the historical Phase-12A…12R telecom
control-plane implementation tracking in `PROJECT_STATE.md`.

## Alternatives considered

- **Prepaid-only (wallet).** Rejected — the owner requires postpaid credit.
- **Postpaid-only (invoicing).** Rejected — the owner requires prepaid wallets.
- **Hybrid with two separate billing subsystems.** Rejected — duplicated ledger,
  audit, and reconciliation; two sources of truth; cross-subsystem drift. The
  shared-ledger / per-account-mode design avoids this.
- **Redis-gauge financial authority (the 12R-8 mechanism for money).** Rejected
  (D3) — a Redis projection may drift from the ledger and permit overspend;
  money requires a DB-authoritative check.
- **On-ledger reservations (reserve posts a contra-account leg).** Considered and
  not chosen (D2) — it adds reserve/release ledger churn; the off-ledger hold is
  cleaner and matches the `SpendReservation` precedent (the trade-off is a
  two-source available-balance computation, handled under one lock).

## Consequences and trade-offs

- **Positive:** one ledger spine serves both modes; hybrid without duplication;
  reuses the proven 12R reserve/settle/sweep **pattern** and the money convention;
  authorization composes with the existing fraud hook; **append-only derived
  balances avoid hot-balance-row contention** (legs are inserts; no mutated
  balance row to lock).
- **Negative / trade-offs:** two financial policy engines (wallet vs credit) on
  one ledger add complexity; the Σ=0 trigger and (later) CDR partitions require
  **explicit SQL migrations + drift checks** (F6) and `prisma db push` is
  prohibited on the billing database; available-balance is a **two-source**
  computation (ledger + reservations) that must be read under one lock; per-account
  authorization **serializes** per account (not sharded, by design); heavy async
  (rating, invoicing, reconciliation) leans on the outbox + external cron until
  queue infrastructure is justified.

## Explicitly out of scope

- CDR ingestion/rating pipelines (Phase 14).
- Payment-provider integrations and compliance posture (Phase 15 / SEC-005).
- Activating or modifying the live call path / engine charging; modifying
  `CallAuthorizationService`.
- Tax engines, invoice-numbering jurisdictions, multi-currency conversion
  mechanics, and the **late-settlement accounting treatment / exceptional-debt
  authorization** (open decisions).

## Technical decisions D1–D4 (PROPOSED — technical-architecture approval)

These are **technical** decisions (not owner/commercial) requiring
technical-architecture approval; they are summarized here and detailed in the
sections above.

| # | Decision | Proposed | Approval level |
|---|---|---|---|
| **D1** | Ledger scoping & financial authz | Dual-nature ledger (ADR-0008, nullable `tenantId`); financial authorization **above** the generic helpers; one-tenant-per-transaction; ownership/visibility policy as above | Technical |
| **D2** | Reservation accounting | **Off-ledger** `UsageReservation`; distinct posted balance / active reserved / available balance; exposure counts invoiced-unpaid + uninvoiced-posted once each | Technical |
| **D3** | Financial concurrency | **DB-authoritative** `SELECT … FOR UPDATE` on `BillingAccount`; Redis non-authoritative; deterministic lock order; bounded retry on `40001`/`40P01`; **no deadlock-free claim**; no lock-sharding | Technical |
| **D4** | Idempotency | One non-partitioned table; `(tenantId, operation, key)` uniqueness + **platform namespace** for NULL-tenant ops; per-operation keys; payload-hash conflict detection; no money-key expiry | Technical |

## Open decisions (NOT owner-approved)

These remain open and must not be treated as decided:

- **Schema-level enforcement (before 13-1):** one-tenant-per-transaction DB check
  vs service-only; transaction-owner representation; `IdempotencyKey` platform
  sentinel (D1).
- **Debit/credit sign convention + generic posting contract (before 13-1);**
  chart of accounts + per-operation posting matrix (before 13-3).
- **Late-settlement accounting treatment, recovery policy, and exceptional-debt
  authorization** (F5) — blocks 13-6.
- Credit limits and approval authority — blocks 13-4.
- Billing cycles and payment terms; overdue and suspension policy; tax treatment
  and invoice numbering — blocks 13-7.
- Reservation TTL defaults and operational exposure limits — blocks 13-5.
- Refunds and chargebacks — partial (chargebacks with Phase 15).
- Payment-provider integrations — Phase 15 (SEC-005).
- Tariff, rating, and rounding rules — Phase 14 (usage billing).
- Step-up MFA for financial operations; ledger visibility & audit policy — blocks
  13-9 / admin money actions.

## Implementation dependency matrix (NOT executed)

Dependency-ordered; **none is authorized** by this ADR.

- **13-0 (this amendment):** ADR amendments + technical review + **explicit ADR
  acceptance**.
- **Before 13-1 (ledger foundation):** D1–D4 architecture decisions; ledger
  ownership contract; debit/credit sign convention; generic posting semantics;
  transaction immutability contract; idempotency namespace & uniqueness; currency
  & monetary precision; database-enforcement design (deferred-constraint trigger);
  migration & rollback strategy.
- **Before 13-2 (BillingAccount + COA):** BillingAccount lifecycle; account-lock
  anchor; account ownership & provisioning rules.
- **Before 13-3 (prepaid wallet):** prepaid chart of accounts; funding & debit
  posting matrix; wallet projections.
- **Before 13-4 (postpaid credit):** postpaid credit policy; credit-exposure
  definition; credit-approval authority.
- **Before 13-5 (authorization + UsageReservation):** UsageReservation lifecycle;
  fraud/billing coordination; reservation TTL defaults & operational limits;
  authoritative financial locking.
- **Before 13-6 (settlement + reconciliation):** late-settlement policy;
  uncollected-usage accounting; recovery & reconciliation.
- **Before 13-7 (postpaid invoicing):** invoice & tax policy; billing cycles;
  payment terms; overdue & suspension policy.
- **Before 13-8 (payment posting):** payment posting & allocation contract.
- **Before 13-9 (ledger admin UI):** financial RBAC; step-up MFA requirements;
  ledger visibility & audit policy.

Preserve: **Phase 14 = CDR ingestion and rating; Phase 15 = payment-provider
integrations.** Do not conflate roadmap phases with the historical Phase-12A…12R
implementation history.

## Ledger foundation finalization — R1–R6 (Amendment 2, PROPOSED)

**D1–D4 are ratified** (owner, 2026-11-24). The LF-01…LF-10 design (reported
separately) is finalized with these refinements. **[FACT]** the configured
database is **PostgreSQL 18** (`docker-compose.dev.yml postgres:18-alpine`,
ADR-0003), so `NULLS NOT DISTINCT`, native `uuidv7()`, and deferred constraint
triggers are available; the **running** version is confirmed by the deploy drift
check (R6), not assumed. *(The full implementation-level specification — DDL,
trigger SQL, posting pseudocode, and the complete test matrix — is large; it is
**proposed** as a separate ledger-foundation design document following repo
conventions, to be created only on explicit approval.)*

- **R1 — Immutable ledger-account identity.** The identity attributes — `id`,
  ownership (`tenantId`/platform), `currency`, `type`, `normalBalance`, `code` —
  are **immutable** once created; only descriptive metadata (name/description)
  may change. A referenced account is **never reassigned** to another tenant or
  currency (that would reinterpret posted history). Accounts are **retired**
  (status/`retiredAt`), never deleted; delete is **RESTRICT**. Enforced by a
  BEFORE-UPDATE trigger rejecting changes to immutable columns **and** by denying
  the runtime role UPDATE on those columns.
- **R2 — Database-controlled posting finalization.** Selected mechanism:
  a **restricted posting function** (`SECURITY DEFINER`, owned by a privileged
  role) is the **only** path that writes ledger rows — the **runtime role holds
  no direct INSERT/UPDATE/DELETE** on ledger tables, only EXECUTE on the function.
  The function inserts the transaction + all legs atomically; **deferred
  constraint triggers** (`DEFERRABLE INITIALLY DEFERRED`, checked at COMMIT)
  enforce **≥2 non-zero legs, Σ=0, single currency, valid refs, ownership
  consistency**; **immutability triggers** reject UPDATE/DELETE and reject
  adding legs to a transaction not created in the current `txid`. This prevents
  zero-/single-leg, unbalanced, mixed-currency, invalid-ref, cross-tenant,
  incomplete, reopened, and post-finalization-mutation states. **No
  application-only "posted" flag is relied upon.** **Honest limit:** this binds
  the runtime (and migration) roles; a superuser/table-owner can disable
  triggers — governed by operational controls + audit (R6), not claimed as
  absolute.
- **R3 — Posting ↔ locking boundary.** The 13-1 posting primitive is an
  **internal, restricted accounting primitive** — **not** an unrestricted
  financial-mutation endpoint (no public route). **13-1 introduces no
  BillingAccount and no account lock** (a balanced post is self-contained and
  needs none; **generic balancing does NOT guarantee sufficient funds**).
  **13-2** introduces `BillingAccount` as the **canonical per-account lock
  anchor**; from 13-2 **every** funds/exposure mutation participates in that one
  locking protocol, so later prepaid-balance, credit-exposure, reservation,
  authorization, and account-lifecycle checks cannot be bypassed. **No temporary
  locking mechanism** is introduced in 13-1.
- **R4 — Idempotency integrity.** Keep `UNIQUE NULLS NOT DISTINCT (tenantId,
  operation, key)` (PG18) with an explicit platform namespace via nullable
  `tenantId` (null = platform). A **single authoritative relationship** is used:
  **`IdempotencyKey.resultTransactionId`** (FK → LedgerTransaction) — the
  redundant `LedgerTransaction.idempotencyKeyId` is **dropped**, giving O(1)
  replay and no bidirectional-consistency burden. The posting function sets the
  key's `tenantId`/`operation` to the transaction's, so **ownership/operation
  always match** and tenant/platform operations cannot impersonate one another;
  `resultTransactionId` can only reference the key's own transaction. **Concurrent
  `ON CONFLICT` (READ COMMITTED):** `INSERT … ON CONFLICT (tenantId,operation,key)
  DO NOTHING` — a concurrent inserter **blocks until the first transaction
  commits or rolls back**, then re-reads the committed row; **same fingerprint →
  return the committed `resultTransactionId`; different fingerprint → reject
  (409)**. Completed records are immutable; money-post keys are **retained** (no
  deletion/expiry that would permit historical double-posting).
- **R5 — Money & overflow.** Signed micros; **debit = +, credit = −**; individual
  amount **`BIGINT`**; application arithmetic in **`BigInt`** (never JS `Number`);
  **SQL aggregation in `NUMERIC`** (cast before `SUM`, so balances never overflow
  `BIGINT`); **API monetary values as decimal strings**. Individual amounts are
  **bounded** well inside `BIGINT` (e.g. ±1e15 micros = ±1e9 units), which also
  makes **reversal negation always representable** and sidesteps the **minimum-
  `BIGINT` (−2^63) negation edge** (its negation is not a valid `BIGINT`) — MIN is
  rejected explicitly; aggregates stay in `NUMERIC`. Decimal input → micros by
  **exact integer parse** (×1e6, reject >6 fractional digits / non-decimal);
  currency minor-unit conversion only at the payment-provider boundary; zero-value
  legs rejected (`CHECK <> 0`). Canonical fingerprint serializes amounts as
  **decimal strings** with deterministic key order. **Financial aggregates are
  never converted to JS `Number`.** Phase-14 rating/rounding is **not** finalized.
- **R6 — Database roles & drift enforcement.** Three roles: **runtime
  application** (least privilege — EXECUTE on the posting function + SELECT for
  reads; **no** direct INSERT/UPDATE/DELETE/TRUNCATE on ledger tables, **no**
  ALTER / trigger-disable / constraint-drop / index-drop), **migration** (DDL,
  used only by migrations), **privileged admin** (break-glass, operationally
  controlled + audited). **CI + deploy drift checks** verify not just object
  **existence** but: trigger **enabled state** (`pg_trigger.tgenabled`), deferred
  configuration, **function definitions** (hash of `pg_get_functiondef`), FK and
  CHECK definitions, **uniqueness semantics** (`pg_index.indnullsnotdistinct`),
  and **role privileges/restrictions** (`information_schema.role_table_grants`).
  No roles/permissions are modified by this documentation task.

**DB-004 resolution.** PostgreSQL + Prisma are selected (ADR-0003); custom SQL
(triggers/functions, the `NULLS NOT DISTINCT` index) lives in versioned Prisma
`migration.sql`; a drift check (R6) verifies the managed objects; **`prisma db
push` is prohibited** on the billing database; migrations are additive; after
financial data exists, recovery is **forward-only** (never drop populated ledger
tables). This needs **no new ADR** (the tool choice is ADR-0003); DB-004's
`DATABASE.md` gate row is updated to "resolved — see ADR-0022" **only when this
ADR is Accepted** (not in this task; `DATABASE.md` is not modified here). No
conflict with any Accepted ADR was found.

## Final acceptance safeguards (Amendment 3, ACCEPTED)

Resolved before acceptance; detailed in `docs/LEDGER_FOUNDATION.md`.

- **SECURITY DEFINER security model.** `ledger_post` runs with its owner's
  privileges, so the owner is a **dedicated, least-privileged, non-login,
  non-superuser** role with **no `BYPASSRLS`** and no unnecessary DDL; hardened
  explicit `search_path` + schema-qualified references; `REVOKE EXECUTE FROM
  PUBLIC` + `GRANT EXECUTE` only to approved runtime roles; no dynamic/unrestricted
  SQL; all input validated; authorization against the **trusted server-derived
  tenant/actor context** — caller-supplied `tenantId`/`actorId` alone never
  authorizes; impersonation, cross-tenant posting, and direct-DML bypass are
  prevented; effective/inherited privileges are drift-verified. **`SECURITY
  DEFINER` does NOT by itself provide tenant isolation** — isolation is the
  function's explicit authorization + the structural constraints. Three distinct
  layers (app authN/authZ, DB structural ownership, DB role privilege) are not
  conflated.
- **Ledger read isolation.** Runtime `SELECT` is **not** licence to expose
  unrestricted financial data: tenant reads go through restricted projections
  (owned accounts only; platform legs/identities/metadata hidden; financial RBAC;
  IDOR-safe). ADR-0004 (tenant-owned) + ADR-0008 (dual-nature) are the model;
  **PostgreSQL RLS (ADR-0005) is deferred, NOT active** — a production activation
  gate, not a current claim.
- **Idempotency insertion sequence (resolved).** The key is **claimed** with
  `resultTransactionId = NULL` before the transaction exists, then linked (claim →
  insert transaction + legs → `UPDATE` the key's `resultTransactionId`).
  Completeness is enforced by a **`DEFERRABLE INITIALLY DEFERRED` constraint
  trigger** that, at COMMIT, **re-reads the final persisted `IdempotencyKey` row**
  (not the `NEW` image captured at the initial INSERT) and raises if
  `resultTransactionId IS NULL` — so the valid claim-then-complete sequence passes
  while an **incomplete record can never commit**. This is **not** a native
  deferrable `NOT NULL`/`CHECK` (PostgreSQL does not support deferring those; only
  PK/UNIQUE/FK/EXCLUDE are deferrable). Column nullable (claim window) + the
  deferred completeness trigger + FK + `UNIQUE` → **no circular/contradictory
  FK/nullability**. Exactly one authoritative relationship
  (`IdempotencyKey.resultTransactionId`).

**Implementation-authorization boundary.** This ADR is **Accepted** as the
architecture of record; **it does not authorize any implementation.** Slice 13-1
begins only on separate explicit owner authorization, against
`docs/LEDGER_FOUNDATION.md`'s acceptance criteria.

## Status rationale (now Accepted)

This ADR records an **owner-approved product decision** (hybrid + the five
decisions) and the **accepted** technical architecture: **D1–D4 ratified**,
**LF-01–LF-10** and **R1–R6** accepted, the SECURITY DEFINER / read-isolation /
idempotency-sequence safeguards resolved (§"Final acceptance safeguards"), and the
implementation-level design recorded in `docs/LEDGER_FOUNDATION.md`. Every
decision that blocks **Slice 13-1** is resolved; the items still open
(§"Open decisions") bind **later** slices only. The status is therefore
**Accepted** (2026-11-24). **Acceptance does not authorize implementation** —
Slice 13-1 begins only on separate explicit owner authorization. Commercial
policies and the live-call / media plane remain future, owner-gated work.

## Review & supersession criteria

Revisit or supersede when: the technical decisions and 13-1 blockers are resolved
(an update moving this to Accepted); the CDR volume decision (DB-005) reshapes
rating/settlement; the payment-rails ADR (SEC-005) fixes provider/compliance
posture; or multi-currency conversion / tax / the late-settlement accounting
treatment require concrete mechanics. Any change to the approved hybrid model or
the five owner decisions requires a new ADR referencing this one.
