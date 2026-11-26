# LEDGER_FOUNDATION.md — Telvyn billing ledger foundation (design)

> Status taxonomy: see `PROJECT_STATE.md`. This is the **technical design** for
> the Phase-13 billing ledger foundation (Slice 13-1). It implements **ADR-0022**
> (Accepted) and does not introduce new financial architecture decisions beyond it.
>
> **Implementation status (2026-11-25): Slices 13-1B+C and 13-1D+E MERGED to `main`
> (PR #21 and PR #22; `main` `68d4da2`), including the CI-002 F04 URL-portability fix
> (`0b0d33e`); technically accepted; NOT deployed to any production or shared
> environment.** The four ledger models (`LedgerAccount`, `LedgerTransaction`,
> `LedgerLeg`, `IdempotencyKey`), the enums, the `billing` schema, the deferred
> balancing/completeness constraint triggers, the immutability triggers, the
> `billing.ledger_post` SECURITY DEFINER function (owned by `telvyn_ledger_fn`),
> the ownership-transfer deployment lifecycle, the least-privilege grants, the
> drift check, and the database test matrix all exist as of migration
> `20261125163000_ledger_foundation`. **Still deferred / NOT built:** BillingAccount,
> Wallet, CreditProfile, UsageReservation, account locking, CDR/rating, invoicing,
> payments, UI, any public posting API, live charging (§24). **RLS on the ledger
> tables remains deferred (ADR-0005), NOT active** — the application layer is the
> read-isolation boundary today (§9/§26). Generic balancing never implies
> sufficient funds (that is 13-3+).

## 1. Purpose and scope

Define the append-only double-entry **ledger foundation** that every Telvyn
billing operation (prepaid and postpaid) posts to. Scope is **Slice 13-1**: the
generic ledger primitives, the restricted atomic posting mechanism, database-level
financial integrity, financial authorization, the role model, migration + drift
verification, and tests. **Out of scope:** BillingAccount, Wallet, CreditProfile,
UsageReservation, account locking, CDR/rating, invoicing, payments, UI, live
charging (see §24).

## 2. ADR references

- **ADR-0022** (Accepted) — hybrid prepaid/postpaid; D1–D4; LF-01–LF-10; R1–R6.
- ADR-0003 (PostgreSQL 18 + Prisma), ADR-0004 (tenant isolation), ADR-0005 (RLS
  deferred), ADR-0008 (dual-nature ownership), ADR-0010 (telecom node/health — append-only
  transitions, no database firehose; financial audit = ADR-0022 Amendment 5 BA-14),
  ADR-0021 (fraud/settlement separation). `DATABASE.md` (DB-003/DB-004 resolved),
  `BILLING.md`, `SECURITY.md`.

## 3. Approved owner decisions (OWNER-APPROVED, verbatim from ADR-0022)

1. **Multiple billing accounts** per customer (by currency/service/commercial).
2. **One currency per billing account**; no mixed-currency transaction;
   cross-currency via a separate conversion process.
3. **Configurable reservation TTL** + per-account exposure limits; explicit
   lifecycle; reconciliation.
4. **No ordinary negative prepaid wallet balance**; corrections via authorized
   compensating ledger transactions.
5. **New billing account for billing-mode transitions** (no in-place flip;
   preserve history; resolve obligations before closure).

*(These bind later slices; the generic ledger foundation is model-independent.)*

## 4. Ratified technical decisions (D1–D4)

- **D1** dual-nature ledger ownership + explicit financial authorization + strict
  tenant isolation.
- **D2** off-ledger `UsageReservation` accounting (13-5; not in 13-1).
- **D3** PostgreSQL-authoritative financial concurrency (lock anchor in 13-2).
- **D4** one non-partitioned financial idempotency registry.

## 5. LF-01–LF-10 final design (summary)

Sign convention (LF-01, §11); generic posting contract (LF-02, §12–13);
schema (LF-03, §7); immutability (LF-04, §10/§14); idempotency (LF-05, §16);
precision (LF-06, §11); DB enforcement (LF-07, §15); locking boundary (LF-08,
§23); migration (LF-09, §20); tests (LF-10, §21).

## 6. R1–R6 final safeguards

R1 immutable account identity (§10); R2 DB-controlled posting finalization (§14);
R3 posting/locking boundary (§23); R4 idempotency integrity (§16); R5 money &
overflow (§11); R6 roles & drift (§18–19). Plus the **SECURITY DEFINER security
model** (§17) and **ledger read isolation** (§9).

## 7. Conceptual database schema

**LedgerAccount** (dual-nature; **excluded from `TENANT_SCOPED_MODELS`**)
| col | type | null | notes |
|---|---|---|---|
| id | uuid (uuidv7) | no | PK |
| tenantId | uuid | **yes** | null = platform; FK→Tenant ON DELETE RESTRICT |
| currency | Currency | no | immutable |
| code | text | no | COA code; immutable |
| name | text | no | mutable (descriptive) |
| type | enum ASSET/LIABILITY/REVENUE/EXPENSE/EQUITY | no | immutable |
| normalBalance | enum DEBIT/CREDIT | no | immutable |
| status | enum ACTIVE/RETIRED | no | retire, never delete |
| retiredAt | timestamptz | yes | |
| createdAt | timestamptz | no | |
Unique: `(tenantId, currency, code) NULLS NOT DISTINCT`. Index `(tenantId, type)`.
Delete: RESTRICT.

**LedgerTransaction** (immutable)
| col | type | null | notes |
|---|---|---|---|
| id | uuid | no | PK |
| operation | text | no | e.g. fund/adjust/reverse/settle |
| ownerTenantId | uuid | **yes** | the single tenant owner (null = platform-only); scoping + one-tenant enforcement |
| currency | Currency | no | single transaction currency |
| effectiveAt | timestamptz | no | |
| correlationId | text | yes | |
| sourceType / sourceRef | text | yes | provenance |
| actorId | uuid | yes | adjustments require it |
| reversalOfId | uuid | yes | self-FK |
| createdAt | timestamptz | no | no `updatedAt` |
Index `(ownerTenantId, effectiveAt)`, `(correlationId)`.

**LedgerLeg** (immutable)
| col | type | null | notes |
|---|---|---|---|
| id | uuid | no | PK |
| transactionId | uuid | no | FK→LedgerTransaction ON DELETE RESTRICT |
| accountId | uuid | no | part of composite FK |
| currency | Currency | no | **composite FK `(accountId,currency)`→LedgerAccount(id,currency)** |
| amountMicros | bigint | no | **signed; CHECK `<> 0`** |
| createdAt | timestamptz | no | |
Index `(transactionId)`, `(accountId)`.

**IdempotencyKey** (non-partitioned; completed records immutable)
| col | type | null | notes |
|---|---|---|---|
| id | uuid | no | PK |
| tenantId | uuid | **yes** | null = platform; FK→Tenant |
| operation | text | no | |
| key | text | no | |
| requestFingerprint | text | no | server-generated hash |
| fingerprintVersion | int | no | |
| resultTransactionId | uuid | **yes (mid-txn) → required at commit** | FK→LedgerTransaction; **UNIQUE**; completeness via a deferred constraint trigger (§16) |
| createdAt | timestamptz | no | |
Unique: `(tenantId, operation, key) NULLS NOT DISTINCT`; `UNIQUE(resultTransactionId)`.
No expiry.

## 8. Entity relationship diagram (ASCII)

```
Tenant ──1:N──> LedgerAccount (tenantId NULL = platform)
                     ^   (accountId, currency) composite FK
                     │
LedgerTransaction ──1:N──> LedgerLeg   [Σ signed amountMicros = 0, ≥2 non-zero]
   (ownerTenantId NULL = platform)         │
        ^ 1:1 (unique)                      │
        └──────── IdempotencyKey.resultTransactionId
LedgerTransaction.reversalOfId ──> LedgerTransaction (self, reversal)
```

## 9. Ownership & visibility matrix (R-read-isolation)

| Entity | Tenant-owned | Platform-owned | Tenant-visible |
|---|---|---|---|
| LedgerAccount | `tenantId` set (customer liability) | `tenantId=null` (revenue/COGS/promo/suspense) | own accounts only |
| LedgerTransaction | `ownerTenantId` set | `ownerTenantId=null` | own transactions only |
| LedgerLeg | via account | via account | **only legs on owned accounts**; platform legs/metadata hidden |
| IdempotencyKey | `tenantId` set | `tenantId=null` | not exposed to tenants |

**Read isolation (R7):** runtime `SELECT` grants are **not** permission to expose
unrestricted financial data. Tenant-facing reads go through **restricted read
projections** (scoped service queries / views) that: filter by owned accounts
only; **never** reveal platform leg amounts, platform account identities, or
confidential transaction metadata; apply financial RBAC (`billing`/`ledger.*`
permissions); and are IDOR-safe. This complements ADR-0004 (tenant-owned models)
and ADR-0008 (dual-nature). **PostgreSQL RLS (ADR-0005) is deferred and NOT
active**; the application layer is the enforcement boundary today. Production
activation of RLS on ledger tables is a **future production gate** (§26), not a
claim of current protection.

## 10. Financial identity immutability (R1)

Immutable once created: `id`, ownership (`tenantId`), `currency`, `type`,
`normalBalance`, `code`. Mutable: descriptive metadata (`name`, description).
A referenced account is **never reassigned** to another tenant or currency (it
would reinterpret posted history). Accounts are **retired** (`status=RETIRED`),
never deleted; delete is **RESTRICT**. Enforced by (a) a BEFORE-UPDATE trigger
rejecting changes to immutable columns, and (b) denying the runtime role UPDATE
on ledger tables (§18). Posted `LedgerTransaction`/`LedgerLeg` rows are fully
immutable (no UPDATE/DELETE).

## 11. Debit/credit & money conventions (R5)

- **Signed micros**, **debit = +, credit = −**; a transaction balances when
  `Σ amountMicros = 0` with **≥2 non-zero legs**. Zero-value legs rejected.
- Account **balance** = `Σ signed legs` on the account (sign per `normalBalance`
  gives the natural presentation).
- Storage: individual `amountMicros` **`BIGINT`**, bounded **±1e15 micros
  (±1e9 currency units)** — a **technical limit, not an approved credit limit**.
- App arithmetic: **`BigInt`** (never JS `Number`). **SQL aggregation: `NUMERIC`**
  (cast before `SUM`; balances never overflow `BIGINT`). **API serialization:
  decimal integer strings** (never a JS `Number` for monetary aggregates).
- **MIN-BIGINT (−2⁶³) rejected** (its negation is not a valid `BIGINT`); the ±1e15
  bound keeps reversal negation always representable → **overflow-safe reversals**.
- Decimal input → micros by **exact integer parse** (×1e6; reject >6 fractional
  digits / non-decimal). Currency minor-unit conversion only at the payment
  boundary. Tariff/rating/rounding and external conversion stay **open** (Phase 14).

## 12. Generic ledger posting contract

`post(input)` — the only sanctioned posting path:
```
input = { operation, ownerTenantId | PLATFORM, currency, effectiveAt,
          correlationId?, sourceType?, sourceRef?, actorId?, reversalOfId?,
          idempotencyKey, requestFingerprint, fingerprintVersion,
          legs: [{ accountId, amountMicros /* signed, != 0 */ }] }
output = { transactionId }   // ALLOW; or a typed error
errors = ValidationError | AuthzError | ConflictError(409) | ConstraintError
```
Boundaries: **posting = one DB transaction**; **authorization = the financial
posting service / function** (§17), never caller-supplied ids alone; **integrity =
the database** (§14–15).

## 13. Conceptual `ledger_post()` pseudocode (SQL, illustrative only)

```
-- SECURITY DEFINER function; runtime role has EXECUTE only (no table DML).
FUNCTION billing.ledger_post(payload jsonb) RETURNS uuid
  SECURITY DEFINER SET search_path = pg_catalog  -- hardened; all refs schema-qualified
AS $$
  -- 1. AUTHORIZE: operation + ownerTenantId + actor against the trusted,
  --    server-derived context (NOT payload alone). Reject impersonation.
  -- 2. VALIDATE: single currency; >= 2 legs; every amount <> 0;
  --    Σ amount = 0; accounts exist, currency matches, owned by {ownerTenant, platform}.
  -- 3. CLAIM idempotency (resultTransactionId NULL for now):
  INSERT INTO billing."IdempotencyKey"(tenantId, operation, key, requestFingerprint, fingerprintVersion)
    VALUES (...) ON CONFLICT (tenantId, operation, key) DO NOTHING;
  IF NOT inserted THEN
    -- concurrent/prior claim: ON CONFLICT blocks until that txn ends, then:
    row := SELECT * FROM billing."IdempotencyKey" WHERE (tenantId,operation,key)=(...);
    IF row.requestFingerprint = payload.fingerprint THEN RETURN row.resultTransactionId; -- replay
    ELSE RAISE 'IDEMPOTENCY_CONFLICT';  -- 409 payload mismatch
    END IF;
  END IF;
  -- 4. INSERT transaction + legs:
  txn := INSERT INTO billing."LedgerTransaction"(...) RETURNING id;
  INSERT INTO billing."LedgerLeg"(transactionId=txn, ...) ...;
  -- 5. FINALIZE idempotency link:
  UPDATE billing."IdempotencyKey" SET resultTransactionId = txn WHERE (tenantId,operation,key)=(...);
  RETURN txn;
  -- At COMMIT: deferred constraints assert Σ=0, >=2 legs, currency/ownership,
  -- and resultTransactionId IS NOT NULL (no incomplete idempotency record commits).
$$;
```

## 14. Database finalization mechanism (R2)

The **`ledger_post` `SECURITY DEFINER` function is the only write path**; the
runtime role has **no direct INSERT/UPDATE/DELETE** on ledger tables (§18). The
function inserts transaction + legs atomically within the caller's transaction.
**Deferred constraint triggers** (`DEFERRABLE INITIALLY DEFERRED`, at COMMIT)
enforce the invariants; **immutability triggers** reject UPDATE/DELETE and reject
adding a leg to a transaction **not created in the current `txid`** (prevents
post-finalization leg additions and reopening). **No application-only "posted"
flag** is relied upon. **Honest limit:** this binds the runtime and migration
roles; a superuser/table-owner can disable triggers — governed by operational
control + audit, not claimed absolute.

## 15. Deferred constraint trigger design

At COMMIT, per affected `LedgerTransaction`: **≥2 non-zero legs**; **Σ signed
amountMicros = 0**; **single currency** (all legs == transaction currency —
composite FK already pins leg currency to its account); **valid account refs**
(FK); **ownership consistency** (legs ⊆ {`ownerTenantId`, platform}; no
cross-tenant); **idempotency completeness** (`resultTransactionId IS NOT NULL`).
Immediate: `CHECK(amountMicros <> 0)`. Prevented-state → enforcing-constraint
table:

| Invalid state | Prevented by |
|---|---|
| no-leg / single-leg | deferred ≥2-legs check |
| unbalanced | deferred Σ=0 |
| zero-value leg | immediate CHECK |
| mixed currency | composite `(accountId,currency)` FK + deferred single-currency |
| invalid account | FK |
| cross-tenant posting | deferred ownership check |
| add legs after finalization / reopen | current-`txid` leg-insert trigger |
| update/delete posted txn/leg | immutability trigger + revoked DML |
| incomplete idempotency commit | deferred completeness **constraint trigger** (re-reads row; `resultTransactionId IS NOT NULL`) |

Rollback: any raised exception aborts the whole transaction. Performance: deferred
checks run once per transaction over its few legs (index `LedgerLeg(transactionId)`).

## 16. Financial idempotency lifecycle (R4 + insertion sequence)

**Insertion sequence (resolved):** the key must be **claimed before** the result
transaction exists. Within one DB transaction: (1) `INSERT IdempotencyKey` with
`resultTransactionId = NULL` (claim), (2) insert transaction + legs, (3) `UPDATE`
the key's `resultTransactionId`. The column is **nullable** (to allow the claim
window); completeness is enforced by a **`DEFERRABLE INITIALLY DEFERRED`
constraint trigger** that at COMMIT **re-reads the final persisted row**
(`SELECT … WHERE id = NEW.id` — the current state after the link UPDATE, **not**
the `NEW` image from the initial INSERT) and raises if `resultTransactionId IS
NULL` — so claim-then-complete passes and an **incomplete idempotency record can
never commit**. This is **not** a native deferrable `NOT NULL`/`CHECK` (PostgreSQL
does not support deferring those; only PK/UNIQUE/FK/EXCLUDE are deferrable). No
circular/contradictory FK/nullability: nullable column + the deferred completeness
trigger + FK + `UNIQUE`. **Exactly one authoritative relationship:**
`IdempotencyKey.resultTransactionId` (unique); `LedgerTransaction.idempotencyKeyId`
is **not used**.
- Uniqueness `(tenantId, operation, key) NULLS NOT DISTINCT` (PG18) — platform
  (null tenant) ops deduped without a sentinel-FK.
- The function sets the key's `tenantId`/`operation` to the transaction's →
  **ownership/operation always consistent**; tenant/platform cannot impersonate.
- **Concurrent `ON CONFLICT DO NOTHING`** blocks until the first txn commits/
  rolls back, then re-reads: **same fingerprint → return committed
  `resultTransactionId`; different fingerprint → 409**.
- Server-generated **canonical fingerprint** (hash of canonical JSON; amounts as
  decimal strings; deterministic key order) + `fingerprintVersion`.
- Completed records **immutable**; money-post keys **retained** (no deletion /
  unsafe expiry → no historical double-posting). **Uncertain-commit recovery:**
  if committed, a retry replays the result; if not, no effect — retry with the
  same key is safe.

## 17. SECURITY DEFINER security model (R6 safeguard)

`ledger_post` runs with its **owner's** privileges, so the owner is a **dedicated,
least-privileged, non-login role** that **is not a superuser** and holds **no
`BYPASSRLS`** and **no unnecessary DDL** — only the minimal DML on the ledger
tables the function needs. Hardening: **explicit hardened `search_path`** (e.g.
`SET search_path = pg_catalog`) with **all object references schema-qualified**;
**`REVOKE EXECUTE … FROM PUBLIC`** and **`GRANT EXECUTE` only to the approved
runtime role(s)**; **no unsafe dynamic SQL**; **no unrestricted/generic SQL
execution**; **validate all input**; **explicit financial-operation authorization**
against the **trusted server-derived tenant/actor context** — **caller-supplied
`tenantId`/`actorId` alone never establishes authorization**; prevent
tenant/platform impersonation, unauthorized cross-tenant posting, and direct-DML
bypass; **verify effective and inherited role privileges** (drift, §19). Three
distinct enforcement layers, not conflated: **(i) application authN/authZ**,
**(ii) database structural ownership enforcement** (FKs, triggers, constraints),
**(iii) database role-privilege enforcement** (grants). **`SECURITY DEFINER` does
NOT by itself provide tenant isolation** — isolation comes from the function's
explicit authorization logic + the trusted context + the structural constraints,
**not** from the definer mechanism.

## 18. Runtime & migration role model (R6)

| Role | May | May **not** |
|---|---|---|
| runtime application | `EXECUTE billing.ledger_post`; `SELECT` via restricted read projections | direct INSERT/UPDATE/DELETE/**TRUNCATE** on ledger; ALTER/**disable triggers**/drop constraints/drop indexes; be the function owner |
| function owner (definer) | minimal DML the function needs | superuser; `BYPASSRLS`; login; unnecessary DDL |
| migration | DDL via versioned migrations | ad-hoc runtime posting |
| privileged admin | break-glass (audited) | routine use |

No roles/grants are modified by this documentation task.

## 19. Database drift verification (R6)

CI + deploy checks verify **semantics, not just names**: trigger existence **and
enabled state** (`pg_trigger.tgenabled`); deferred-constraint configuration;
**function definition** (hash of `pg_get_functiondef`) and its `search_path` +
owner + non-superuser/non-BYPASSRLS; **FK and CHECK** definitions; **uniqueness
semantics** (`pg_index.indnullsnotdistinct`); and **role privileges/restrictions**
(`information_schema.role_table_grants` + runtime role has no DML/TRUNCATE/trigger-
disable). Missing/altered → the deploy fails closed.

## 20. Migration & forward-recovery strategy (LF-09)

Additive Prisma migration (tables/enums/FKs/CHECKs) **+ raw SQL in the same
`migration.sql`** for the functions, deferred constraint triggers, immutability
triggers, and the `NULLS NOT DISTINCT` indexes (not expressible in
`schema.prisma`). A drift check (§19) verifies the managed objects post-migrate.
**`prisma db push` is prohibited** on the billing database. Rollback tiers:
disposable **dev** → reset OK; **pre-activation** (empty ledger) → down-migration
dropping empty tables OK; **production with financial data → forward-only**
(corrective migration / compensating entries; **never drop populated ledger
tables**).

## 21. Financial integrity test matrix (DESIGNED ONLY — none executed)

Tests run against the **actual restricted runtime role** (not only superuser/
migration role). Classification: **designed** (all, now) / executed / passed /
blocked / deferred.

- **13-1 mandatory — unit:** precision/overflow incl. **MIN-BIGINT rejection**,
  NUMERIC-vs-Number aggregate exactness, debit/credit sign, posting validation,
  fingerprint same/different, ownership validation.
- **13-1 mandatory — DB integration (live PG, runtime role):** balanced accepted;
  unbalanced / zero-leg / single-leg / zero-value / mixed-currency / invalid-
  account / **cross-tenant** rejected at commit; posted-txn & posted-leg UPDATE/
  DELETE rejected; add-legs-after / reopen rejected; account ownership/currency/
  type/normal-balance mutation rejected; **direct-SQL posting bypass rejected**;
  **runtime-role TRUNCATE rejected**; **runtime-role trigger-disable rejected**;
  **runtime-role direct DML rejected**; **unauthorized function execution
  rejected**; **PUBLIC EXECUTE rejected**; **function-owner privilege + effective/
  inherited privilege verified**; **SECURITY DEFINER `search_path` verified**;
  **cross-tenant read leakage rejected**; idempotency ownership/operation mismatch
  rejected; **incomplete idempotency commit rejected**; completed-idempotency
  mutation + historical-deletion rejected; **aggregate exceeding BIGINT (NUMERIC)**.
- **13-1 mandatory — concurrency:** concurrent duplicate (one post); same-key/
  different-payload (409); **concurrent platform duplicate**; atomic rollback;
  **uncertain-commit recovery**.
- **13-1 mandatory — security:** tenant isolation; platform authz; unauthorized
  posting; metadata leakage; IDOR; audit.
- **13-1 mandatory — migration/drift:** clean + additive migration; trigger/
  function existence **+ enabled**; constraint enforcement; **disabled-trigger +
  incorrect-index drift detection**; existing-suite regression.
- **13-2:** `SELECT FOR UPDATE` lock, ordering, retry (40001/40P01).
- **Before production activation:** full role-privilege drift; RLS activation
  decision; running-PG-version verification.
- **Deferred (later slices):** wallet/credit/reservation/settlement/invoice/payment.

## 22. Slice 13-1 acceptance criteria

All §21 "13-1 mandatory" tests **pass** against the **restricted runtime role**;
drift checks green; the four models + `ledger_post` + triggers + roles land via an
additive migration with raw SQL; money utility + financial authorization in place;
no excluded item (§24) is implemented; ADR-0022 / this document unchanged in
substance. **Generic balancing never implies sufficient funds** (that is 13-3+).

## 23. Slice 13-2 locking dependency (R3)

13-1 introduces **no account lock** (a balanced post is self-contained). 13-2
introduces `BillingAccount` as the **canonical per-account lock anchor**
(`SELECT … FOR UPDATE`); from 13-2, **every** funds/exposure mutation participates
in that one protocol (deterministic lock order, bounded retry on 40001/40P01,
idempotent, fail-closed, Redis never authoritative). The 13-1 posting primitive
stays an **internal restricted accounting primitive** — never an unrestricted
financial-mutation endpoint.

## 24. Explicit exclusions

BillingAccount, Wallet, CreditProfile, UsageReservation, account-lock
implementation, CDR ingestion, rating engine, invoice generation, payment
integrations, billing UI, live charging, SIP/RTP runtime. No live call path is
activated.

## 25. Remaining owner decisions (OPEN)

Late-settlement accounting treatment / exceptional-debt authorization; credit
limits & approval; billing cycles, terms, overdue/suspension; tax & invoice
numbering; refunds/chargebacks; payment providers; tariff/rating/rounding;
step-up MFA for money actions; per-operation posting matrix + seeded chart of
accounts (13-2/13-3). **None blocks Slice 13-1.**

## 26. Production activation gates

Verify the **running** PostgreSQL version (≥15 for `NULLS NOT DISTINCT`;
configured = 18); target DB is an **authorized, explicitly non-production** env
for testing; runtime vs migration role separation is real in the target; required
PG features present; (future) **RLS activation** on ledger tables (ADR-0005);
full role-privilege + drift verification. **No live charging or call
authorization** is activated by this foundation.

## 27. Application integration — Slice 13-1D+E (merged, `main`, PR #22)

The TypeScript money utility and the internal posting adapter that complete the
13-1 foundation at the application boundary. Internal infrastructure only — no
public endpoint, no DTO, no commercial action; inert until an authorized operation
invokes it. The merged DB foundation (§1–§26) is unchanged.

- **Money representation** (`src/billing/money.ts`). Canonical = signed **BigInt
  micros** (1 unit = 1,000,000 micros). Never a JS `number`; no
  `parseFloat`/`parseInt`/`Number`/`toFixed`/`Math.round`/float ×÷. Bounds: a
  **ledger leg** is non-zero and within ±1e15 micros; a **general** amount may be
  zero (still ±1e15); **aggregates** are exact unbounded `bigint`. A branded
  `Micros` type keeps `number` out at compile time.
- **Decimal grammar (pinned, conservative — §8).** `^[+-]?\d+(\.\d{1,6})?$` with a
  length cap. Rejects `number` inputs, NaN/Infinity, scientific/hex, separators,
  whitespace, empty, >6 fractional digits, and out-of-range. Leading integer zeros
  tolerated; negative zero normalized to `0`. Never silently rounds/truncates.
- **Serialization.** Monetary values cross JSON as exact **integer-micros strings**
  (never BigInt/number); canonical **decimal strings** for display. The DB
  `ledger_post` jsonb contract accepts amount strings (`(l->>'amountMicros')::bigint`)
  with no precision loss and **no DB change**.
- **Idempotency fingerprint (v1).** Server-computed at the trusted boundary (the DB
  **stores + compares** a supplied fingerprint; it does not compute one). SHA-256
  over a canonical form: fixed key order, amounts as decimal strings, and **legs
  sorted** (a double-entry transaction is an unordered balanced set — leg input
  order is insignificant; documented choice). Any financially significant field
  change (operation/owner/actor/currency/effectiveAt/reversal/source/leg account or
  amount) changes the fingerprint. Retries MUST reuse the same key **and** payload.
- **Trusted context + authorization boundary** (`TrustedLedgerContext`). An
  unforgeable token carrying the **server-established** owner (tenant | platform),
  actor, and operation. Provenance is enforced at runtime by a **module-private
  WeakSet capability registry** (13-1E hardening) — not merely a Symbol brand,
  which a spread/clone/`getOwnPropertySymbols` copy could carry: only a context
  this module minted is accepted, and the fields are **deeply frozen** (no
  post-authorization mutation). A request DTO / plain / spread / cloned object is
  rejected. **Honest residual:** minting a context is a privileged packaging
  primitive, not an authorization decision — **which operations/owners may post is
  the DEFERRED commercial RBAC** (ADR-0022 "Open decisions"). In 13-1D/E no
  production code constructs a context (the service is inert; verified — the only
  `ledger_post` call site is the adapter); only a future authorized operation
  (13-2+) or a test fixture does.
- **Trusted-context GUCs + transaction locality** (§15–§16). The service sets
  `app.tenant_id` / `app.is_platform` / `app.actor_id` **all three explicitly**
  (no inheritance), **transaction-locally** (`pg_catalog.set_config(name, value,
  true)`, parameterized — never interpolated), on the **same** Prisma interactive
  transaction client used to call `ledger_post`. Verified no cross-request leak on
  pooled-connection reuse.
- **Transaction composition** (§17). `postInTransaction(tx, …)` posts inside a
  caller transaction (future: open tx → BillingAccount lock → validate → post →
  commit) and returns a **pending** result; `post(…)` runs its own transaction and
  returns a **committed** result — success is never reported before the deferred
  commit checks pass.
- **Error contract** (`ledger-errors.ts`). SQLSTATEs (LG001..LG033, 23xxx, 42501,
  40001/40P01) and app-side money errors map to a stable typed hierarchy
  (`INVALID_MONEY_INPUT` / `INVALID_LEDGER_STRUCTURE` / `CURRENCY_MISMATCH` /
  `OWNERSHIP_MISMATCH` / `MISSING_AUTHORIZATION_CONTEXT` / `IDEMPOTENCY_CONFLICT` /
  `DEFERRED_INVARIANT` / `IMMUTABLE_HISTORY` / `DATABASE_PRIVILEGE` / `CONCURRENCY`
  / `CONSTRAINT` / `SERIALIZATION` / `UNKNOWN`). Never leaks SQL, parameters, or
  credentials; unknown errors are surfaced as `UNKNOWN`, never swallowed.
- **Trust limitation (honest).** `app.*` GUCs are **caller-settable** by
  `telvyn_app`. The adapter secures the normal trusted application path; it does
  **not** implement RLS and does **not** defend against arbitrary SQL executed
  under a compromised runtime credential. RLS activation on ledger tables stays
  deferred (ADR-0005). Four distinct layers are preserved and not conflated:
  (A) app authentication, (B) app financial authorization [commercial matrix
  deferred], (C) DB structural integrity, (D) DB role privileges.
- **Open commercial decisions** (unchanged, ADR-0022 "Open decisions"): the
  per-operation posting matrix + seeded chart of accounts, BillingAccount lifecycle
  + locking (13-2), credit/limits, invoicing/tax, payment rails. None blocks 13-1.
