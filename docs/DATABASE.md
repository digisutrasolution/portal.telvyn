# DATABASE.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md (EXISTING / PLANNED / PROPOSED / UNKNOWN).
> Severity scale used by audits: CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL.

## Current state — EXISTING

**No database exists.** A full repository audit (2026-08-26, method below)
found zero database artifacts: no live schema, no ORM schema (Prisma or
otherwise), no migrations, no SQL files, no repositories, no services, no
queries. This document records the committed conventions, the draft domain
model, and the standing audit findings + checklist that the first real schema
must satisfy.

---

## Database audit — 2026-08-26

### Methodology

- Full file inventory of the repository (17 files, all Markdown).
- Pattern search for `*.sql`, `*.prisma`, `migration*`, `*.db`, `schema*`,
  repository/service source files, and embedded query strings
  (`SELECT`/`INSERT`/`CREATE TABLE`/ORM identifiers) — **zero matches**.
- Conclusion: there are no tables, relations, foreign keys, indexes,
  constraints, or queries to inspect. Object-level findings are impossible;
  the audit therefore reports design-gate findings and establishes the
  acceptance checklist for the future schema.

### Findings register

| ID | Severity | Finding | Required action |
|---|---|---|---|
| DB-001 | INFORMATIONAL | No database, schema, migrations, ORM, or query code exists. Expected for Phase 0 — not a defect, but it means **no production data exists to protect yet**, and every convention below is unenforced until the first migration lands. | None now; this register re-runs against the first migration. |
| DB-002 | **CRITICAL** (design gate) | **Tenant/customer isolation mechanism is undecided** (app-scoped `WHERE owner_id` vs PostgreSQL RLS). Constitution mandates data-layer isolation; until the mechanism is chosen, no owned table can be safely designed. A wrong or late choice is the #3 risk in the ARCHITECTURE.md risk register (cross-tenant leakage). | Resolve by ADR **before** the first migration. Blocking. |
| DB-003 | **RESOLVED (architecture)** — see **ADR-0022** (Accepted) | **Billing model decided: HYBRID** prepaid wallet + postpaid credit (mode per BillingAccount, shared double-entry ledger). The ledger foundation is designed in `LEDGER_FOUNDATION.md`. **Architecture decision resolved ≠ implemented**: no billing/ledger code, tables, triggers, wallets, or services exist yet; implementation is Phase-13 Slice 13-1+ (not started). | — (resolved; implementation gated separately) |
| DB-004 | **RESOLVED (architecture)** — see **ADR-0003** + **ADR-0022** | **PostgreSQL 18 + Prisma** (ADR-0003); the migration lane is in active use. Custom SQL (partial / `NULLS NOT DISTINCT` indexes, ledger constraint & immutability triggers) lives in versioned `migration.sql`; **`prisma db push` is prohibited** for managed billing databases; a **drift check** verifies managed objects (existence, enabled state, definitions, semantics, role grants); migrations are additive; after financial data exists, recovery is **forward-only**. **Architecture decision resolved ≠ implemented** (the ledger triggers/tables are not built yet). | — (resolved; see `LEDGER_FOUNDATION.md` §19–20) |
| DB-005 | MEDIUM | **CDR/usage volume unknown** → partitioning granularity (monthly proposed), retention windows, and archive strategy are unsized. Partitioned tables also constrain PK/unique design (partition key must be in the PK; global uniques are lost) — this must be known before the CDR table is designed, not discovered after. | Owner supplies expected call/CDR volume; ratify partition + retention design in the CDR ADR. |
| DB-006 | MEDIUM | **No backup/PITR path ratified** (DR doc targets RPO ≤ 15 min / RTO ≤ 4 h are PROPOSED, not signed off; tooling UNKNOWN pending hosting). First production deploy without this = unprotected data. | Sign off DR targets; implement backups in the same deploy that creates the production DB. |
| DB-007 | LOW | **UUIDv7 default strategy unpinned.** Convention says UUIDv7 PKs; native `uuidv7()` requires PostgreSQL 18, otherwise an extension or app-generated v7 is needed. The PostgreSQL version itself is undecided. | Pin PG version in ADR-0002; choose DB-default vs app-generated v7 accordingly (DB default preferred so bulk/COPY paths inherit it). |
| DB-008 | LOW | **Repository is not under git.** Once migrations exist, their history *is* the schema audit trail; without version control there is none. | `git init` + remote before the first migration (already PROPOSED in PROJECT_STATE.md). |

### Audit checklist — the 23 dimensions (all currently NOT BUILT)

Every dimension below was requested by the audit and has **no implementation to
inspect**. Each is recorded as the acceptance requirement the first schema
must meet; this table is the re-run checklist for the next database audit.

| # | Dimension | Status today | Acceptance requirement for the future schema |
|---|---|---|---|
| 1 | Tables | NOT BUILT | Normalized; every table has PK, audit columns, and an owner (or explicit platform-scope rationale) |
| 2 | Relations | NOT BUILT | All relations explicit; no implicit join-by-convention |
| 3 | Foreign keys | NOT BUILT | FKs on every relation (constitution: no FK-less tables). Partitioned firehose tables document any FK exceptions explicitly |
| 4 | Indexes | NOT BUILT | Index every FK column and every WHERE/ORDER BY path used by list endpoints; reviewed per migration |
| 5 | Constraints | NOT BUILT | NOT NULL by default; CHECK constraints for state machines (DID status), enums for closed sets; DB-level guards for ledger balance (Σ legs = 0 trigger) |
| 6 | UUID usage | NOT BUILT | UUIDv7 PKs everywhere (DB-007 pins the mechanism); no serial/int PKs |
| 7 | Soft deletion | NOT BUILT | `deleted_at` on business tables; natural-key uniques become **partial uniques** (`WHERE deleted_at IS NULL`) so deleted rows can recycle |
| 8 | Audit logging | NOT BUILT | Append-only audit table (actor, action, entity, metadata, IP, timestamp); written in the same transaction as the mutation |
| 9 | Tenant isolation | NOT BUILT | Mechanism per DB-002 ADR; deny-by-default; verified by tests that prove cross-owner queries return nothing |
| 10 | Wallet integrity | NOT BUILT | Balances derived from ledger; no directly-mutated balance column as source of truth; reconciliation job proves cache = Σ ledger |
| 11 | Billing integrity | NOT BUILT | Append-only double-entry ledger; integer minor units; currency-tagged; global (non-partitioned) idempotency table for money posts |
| 12 | CDR architecture | NOT BUILT | Time-partitioned; dedupe key on carrier record id; rating provenance columns if usage billing is in scope (DB-005) |
| 13 | Rate tables | NOT BUILT | Only if usage billing in scope: versioned rate decks (effective-dated, never edited in place) so every charge is reproducible |
| 14 | DID inventory | NOT BUILT | DID table with E.164 (unique, partial), country, lifecycle status enum + CHECK'd transitions, carrier ref, owner ref |
| 15 | Carrier data | NOT BUILT | Carrier table with vaulted credential *references* only — never secrets in rows |
| 16 | Routing data | NOT BUILT | RoutingConfig versioned or audited such that "what was routing at time T" is answerable (fraud forensics) |
| 17 | Payment data | NOT BUILT | Provider-agnostic payment records; no PAN/card data ever stored (keeps PCI scope out); webhook events deduped by provider event id |
| 18 | User/RBAC data | NOT BUILT | User/Role/Permission/UserRole + Session tables; argon2id hashes; secret references only; per-owner unique email as partial unique |
| 19 | Race conditions | NOT BUILT | Known-by-design hot spots documented before build: concurrent wallet spend (reservation or `SELECT ... FOR UPDATE` pattern), DID assign/release races (state-machine CHECK + row lock), idempotent order submission |
| 20 | N+1 queries | NOT BUILT | List endpoints reviewed for eager-loading in code review; slow-query log enabled from first deploy |
| 21 | Missing indexes | NOT BUILT | Index review is a standing item in every migration's PR checklist |
| 22 | Large-table risks | NOT BUILT | CDR, audit log, webhook events identified as the growth tables; retention + archive policy required before production |
| 23 | Partitioning | NOT BUILT | Monthly range partitions PROPOSED for CDR/usage; automated partition pre-creation + monitoring (ARCHITECTURE.md §4); ledger explicitly **never** partitioned |

### Audit verdict

**No defects exist because no database exists.** The two decisions that gate
safe schema design are DB-002 (isolation mechanism — CRITICAL) and DB-003
(billing model — HIGH); nothing schema-related should be built until they are
resolved. The next database audit runs this checklist against the first real
migration set.

---

## Conventions — PLANNED (locked by constitution)

- PostgreSQL; normalized schema; UUID (v7) primary keys
- Soft deletes (`deleted_at`); `created_at`/`updated_at` on every table
- Foreign keys + indexes wherever they belong — no FK-less tables
- Owner/tenant id on every owned row; isolation enforced in the data layer
- Audit log on all mutations (actor, action, entity, metadata, IP)
- Money as integer minor units (`BIGINT`), currency-tagged — never floats
- Balances derived from an append-only double-entry ledger
- Idempotency keys on money-posting / provisioning operations
- High-volume tables (CDR, usage) designed for time-based partitioning
- Migrations are the ONLY path for schema changes

## Domain entities — PROPOSED (draft model; not ratified, not created)

| Entity | Purpose |
|---|---|
| User / Role / Permission / Session | Identity & RBAC |
| Customer or Tenant | DID/balance owner — **shape depends on DB-002 tenancy decision** |
| DID | E.164, country, lifecycle status, carrier ref |
| Carrier / Provider | Upstream DID supplier |
| RoutingConfig | Delivery target for an assigned DID |
| PortRequest | Port-in/out workflow |
| Order | DID purchase/provisioning workflow |
| Wallet / LedgerAccount / LedgerTransaction / LedgerLeg | Billing spine (BILLING.md) |
| Cdr | Call detail records (partitioned) |
| AuditLog | Mutation trail |

## UNKNOWN

- ORM/migration tool (DB-004 — follows ADR-0002)
- Tenancy enforcement mechanism (DB-002 — app-scoped vs PostgreSQL RLS)
- PostgreSQL version (DB-007)
- CDR volume, retention periods per data class (DB-005; regulatory-driven)

## ERD

None — to be generated from the schema once it exists.

---

## Phase 3+4 — Tenancy & RBAC schema IMPLEMENTED (2026-08-27)

Prisma schema `apps/api/prisma/schema.prisma`. Resolves **DB-002 (CRITICAL)**
via ADR-0004.

### New models
- **Tenant** (slug unique, type PLATFORM/RESELLER/CUSTOMER, status, soft delete)
- **Membership** (user↔tenant, unique[userId,tenantId], status) — access to a
  tenant is via membership, never `User.tenantId` alone
- **Role** (tenantId null+isSystem = shared template; tenantId set = custom role;
  unique[tenantId,key])
- **Permission** (key `resource.action`, unique) + **PermissionGroup**
- **RolePermission**, **MembershipRole** (join tables)
- **AuditLog** (tenantId, actorId, action, resource, resourceId, metadata, ip)
- `User.tenantId` repurposed as **primary/home tenant** (was reserved in
  ADR-0003 — additive, no rewrite); `Session.tenantId` added (active tenant).

### DB-002 → CLOSED (isolation mechanism decided, ADR-0004)
Two enforced layers, tenant id always server-derived:
1. **Application layer**: a Prisma client extension (`scoped-prisma.ts`) routes
   every op on a tenant-owned model (`Membership`/`Role`/`AuditLog`) through
   `applyTenantScope`, injecting the context tenantId and **throwing on an
   unscoped access** (deny-by-default). Services use `prisma.scoped.*`.
2. **Database layer (defense-in-depth)**: `prisma/rls/enable-rls.sql`
   enables RLS `FORCE` with a `current_setting('app.tenant_id')` policy; the API
   runs as a NOBYPASSRLS role in prod (enabled at deploy — Phase 20).

### Findings movement
- **DB-002 CRITICAL → CLOSED** (mechanism decided + implemented + tested).
- Checklist dimensions now BUILT (against the auth+authz schema): tables,
  relations, FKs, indexes, constraints, UUIDv7, soft deletes, audit logging,
  tenant isolation, user/RBAC data. Still NOT BUILT (later phases): wallet/
  billing integrity, CDR, rate tables, DID/carrier/routing/payment data.
- Migrations still to be applied against a live DB (no DB access in this env);
  `prisma migrate dev` + `prisma db seed` + the RLS SQL are the deploy steps
  (RUNBOOK.md). Partial-unique recycling for soft-deleted natural keys
  (Tenant.slug, Role[tenantId,key]) remains a raw-SQL follow-up before prod.

---

## Telecom foundation schema — EXISTING (Phase 12B, 2026-08-29)

Migration `20260829002712_telecom_foundation` — **purely additive** (15 enums,
14 tables, 27 indexes, 20 FKs; **zero** changes to existing tables, verified
before apply). Applied to dev; seed re-synced (26 permissions, 4 system roles).

Tables (all UUIDv7 PK, `createdAt`/`updatedAt`, soft-delete where a lifecycle
exists; config/runtime separated per ADR-0010):
`Region`, `TelecomEngine`, `EngineCapability`, `TelecomNode`, `NodeHealth`
(runtime, 1:1), `HealthEvent` (append-only), `Carrier`, `CarrierSipEndpoint`,
`SipTrunk`, `Did`, `RoutingProfile`, `RoutingRule`, `TelecomCredential`
(secret vault, ADR-0009 — `secretEnc` never exposed), `TelecomConfigVersion`
(append-only, secret-free).

Phase 12L (engine runtime foundation) begins **writing** two of these
append-only tables with **no schema change**: `TelecomConfigVersion`
(`entityType="engine"`) records each desired configuration version (a secret-free
SHA-256 fingerprint snapshot) as the versioning substrate, and `HealthEvent`
(`entityType=ENGINE`) records engine health transitions. An *applied*-version
column is intentionally NOT added yet (nothing applies until a real adapter
exists — ADR-0011); it becomes warranted with the first real engine integration.

Tenancy: `SipTrunk`, `RoutingProfile` are strictly tenant-owned (required
`tenantId`); `Carrier`, `Did`, `TelecomCredential` use nullable `tenantId`
(platform/pool vs tenant) per ADR-0008. Data-layer scope registration + the
system-or-tenant read helper land with each resource's service (12E–12H), and
each carries cross-tenant/IDOR tests then.

## SipTrunk carrier link — EXISTING (Phase 12F, 2026-08-29)

Additive migration `sip_trunk_carrier_link`: `SipTrunk.carrierId` (required, FK →
Carrier, `ON DELETE RESTRICT`) + `SipTrunk_carrierId_idx`. Reviewed via
`--create-only` before apply — table verified empty (0 rows), so the NOT NULL add
is safe; no destructive ops, no changes to other tables. `SipTrunk` joins
`TENANT_SCOPED_MODELS` (strictly tenant-owned → auto-scoped).

## DID ↔ SIP trunk link — EXISTING (Phase 12G, 2026-08-29)

Additive migration `did_sip_trunk_link`: `Did.sipTrunkId` (nullable FK → SipTrunk,
`ON DELETE SET NULL`) + indexes on `sipTrunkId`, `routingProfileId`, `regionId`,
`country`. Reviewed via `--create-only` (no destructive ops). `Did` joins
`TENANT_SCOPED_MODELS` (auto-scoped). `Did.e164` retains the **global plain
`@unique`** (12B); partial-unique (recycle after soft-delete) deferred — no data
conflict today. Delete semantics: DID relations are SET NULL (never cascade to
carrier/trunk/profile/region); DID itself soft-deletes.

## Routing rule config — EXISTING (Phase 12H, 2026-08-29)

Additive migration `routing_rule_config`: new enum `RoutingDestinationType`;
`RoutingRule` gains `destinationType` (NOT NULL — safe, table empty), plus
nullable `timeoutSeconds`, `retryCount`, `schedule` (JSONB). Reviewed
`--create-only` (no destructive ops). `RoutingProfile` joined
`TENANT_SCOPED_MODELS` (auto-scoped). Rules order deterministically by
`(priority ASC, id ASC)` on the existing `@@index([routingProfileId, priority])`.

## Routing policy + failover — EXISTING (Phase 12I, 2026-08-29)

Additive migration `routing_policy_failover`: enums `RoutingSelectionStrategy`,
`RoutingFailoverCondition`; `RoutingProfile` gains `selectionStrategy`
(NOT NULL DEFAULT PRIORITY), `failoverEnabled` (DEFAULT false),
`failoverConditions[]`, `maxAttempts?`, `overallTimeoutSeconds?`, and `version`
(NOT NULL DEFAULT 0, optimistic-concurrency); `RoutingRule` gains `weight?` and
`failoverDestinationType?`. All NOT NULL columns carry defaults → safe additive.
No new FailoverPolicy table (policy is 1:1 with the profile). Reviewed
`--create-only`; no destructive ops.

## LCR policy + routes — EXISTING (Phase 12J, 2026-08-29)

Additive migration `lcr_policy`: enums `Currency`, `LcrSelectionStrategy`; tables
`LcrPolicy` (tenant-owned; `@@unique([tenantId,name])`, `version`) and `LcrRoute`
(policy child; `carrierId` FK RESTRICT, `sipTrunkId` FK SetNull; `costMicros`
BIGINT — no float; indexes `[lcrPolicyId, prefix]`, `[lcrPolicyId, enabled]`,
`[carrierId]`). Reviewed `--create-only`; no destructive ops. `LcrPolicy` joined
`TENANT_SCOPED_MODELS`. First BigInt + first Currency enum in the schema.

## Engine credential reference — EXISTING (Phase 12M-1, 2026-11-16)

Additive migration `engine_credential_ref` — the schema foundation for a real
engine management-plane adapter (Phase 12M). Three additive operations, **zero
destructive** (reviewed via `--create-only`; `TelecomEngine` currently 0 rows):

- `enum TelecomCredentialType` gains `ENGINE_API` — the credential kind for an
  engine's management interface (e.g. an mTLS client cert / JSONRPC auth secret).
  Vault-only like `SIP_PASSWORD`/`CARRIER_API`: `secretEnc` never leaves the vault
  (ADR-0009); flows automatically to every `z.nativeEnum(TelecomCredentialType)`.
- `TelecomEngine.credentialId` (nullable UUID, FK → `TelecomCredential`,
  `ON DELETE SET NULL`) + `TelecomEngine_credentialId_idx`. A **reference**, never
  a secret; decryption happens only at the adapter boundary (`revealForAdapter`).
  SET NULL so deleting a credential clears the link without orphaning or deleting
  the engine. Mirrors the existing `Carrier.credentialId` / `SipTrunk.credentialId`
  pattern; `TelecomCredential` gains the `engines` back-relation.

The **applied-version** state (`PENDING_RECONCILIATION` on a timed-out apply) is
NOT a schema column — it extends the existing append-only snapshot model in
`TelecomConfigVersion` (`newConfig.kind`), the option ADR-0011 reserved. No live
egress, DI, or behavior changed by this sub-phase.

## Node-agent credential — EXISTING (Phase 12O-2az, 2026-11-23, ADR-0020 slice 1)

Additive migration `node_agent_credential_ref` — the schema foundation for the
node liveness heartbeat (ADR-0020). Mirrors `engine_credential_ref` exactly, three
additive operations, **zero destructive** (`TelecomNode` currently 0 rows):

- `enum TelecomCredentialType` gains `NODE_AGENT` — the credential kind for a
  node's heartbeat agent (an **mTLS client certificate**, ADR-0020). Vault-only
  like the others: `secretEnc` never leaves the vault (ADR-0009).
- `TelecomNode.credentialId` (nullable UUID, FK → `TelecomCredential`,
  `ON DELETE SET NULL`) + `TelecomNode_credentialId_idx`. A **reference**, never a
  secret; `TelecomCredential` gains the `nodes` back-relation. SET NULL so revoking
  a credential never orphans/deletes the node row.
- **Not** auto-widened into tenant DTOs: unlike the earlier note that `ENGINE_API`
  "flows automatically to every `z.nativeEnum(TelecomCredentialType)`", the carrier
  inline-credential DTO was **frozen** to an explicit allow-list
  (`SIP_PASSWORD`/`CARRIER_API`/`ENGINE_API`) in this slice, so `NODE_AGENT` can
  never be attached to a carrier. A node credential is node-only.

No endpoint, no behaviour change yet — the heartbeat ingest and dead-man's-switch
evaluator that use this column are later ADR-0020 slices. Applied to the dev DB and
verified (`migrate status` → "up to date"); reaches other environments via
`prisma migrate deploy`.

## Engine ↔ resource assignment — EXISTING (Phase 12N-1, 2026-11-17)

Additive migration `engine_resource_assignment` (ADR-0012) — the model of which
resources deploy to which engine, so a future `EngineConfigurationIntent` is
non-empty. Purely additive (reviewed; no existing table changed):

- `enum EngineResourceKind` = `SIP_TRUNK | DID | ROUTING_PROFILE` (the resources a
  SIP router needs; carriers are implied by trunks, not assigned directly).
- `EngineResourceAssignment` (UUIDv7 PK, `enabled`, soft-delete): `engineId` FK →
  `TelecomEngine` (Cascade); a denormalized `tenantId` FK → `Tenant` (Cascade;
  null = platform resource); and **three explicit nullable FKs** `sipTrunkId` /
  `didId` / `routingProfileId` (each Cascade) — real FKs, never a polymorphic id
  (constitution: no FK-less tables).
- **DB CHECK** `..._one_resource_matches_kind`: exactly one resource FK is set and
  matches `kind` — the database refuses an ambiguous assignment. Per-kind
  `@@unique([engineId, <resourceId>])` (NULLs distinct in PG) → a resource is
  assigned to an engine at most once. Indexes on `(engineId, enabled)`,
  `tenantId`, `kind`.

Platform-managed (PlatformGuard, in 12N-2). No service/API/behavior yet.

## Billing ledger foundation — EXISTING (Phase 13-1B+C, 2026-11-25, ADR-0022)

Additive migration `20261125163000_ledger_foundation` — the append-only, double-entry
**ledger spine** (`LEDGER_FOUNDATION.md`). **IMPLEMENTED + VERIFIED on the isolated PG18
environment; NOT deployed to production/shared; NOT committed.** Resolves the DB-003/DB-004
*implementation* (the architecture was resolved by ADR-0022). Four Prisma tables (UUIDv7 PK,
`timestamptz`): `LedgerAccount` (dual-nature nullable tenant; immutable identity; retire-never-
delete), `LedgerTransaction` (immutable; one owner tenant; no `updatedAt`), `LedgerLeg`
(signed `BIGINT` micros; composite FK `(accountId,currency)→LedgerAccount(id,currency)`),
`IdempotencyKey` (non-partitioned; claim→complete). 3 enums. Dual-nature (ADR-0008), **NOT**
in `TENANT_SCOPED_MODELS`; all FKs **ON DELETE RESTRICT** (financial history never cascades).

Raw SQL in the same `migration.sql` (not expressible in `schema.prisma`, verified by
`scripts/db/ledger-drift-check.sql` not Prisma diff): a `billing` schema; `NULLS NOT DISTINCT`
natural-identity unique indexes (PG18); amount CHECK (`<>0` and within ±1e15 micros, rejecting
MIN-BIGINT); **deferred `DEFERRABLE INITIALLY DEFERRED` constraint triggers** (≥2 non-zero legs,
Σ=0 via NUMERIC, single currency, ownership consistency; idempotency completeness re-reading the
final row); **immutability triggers** (no UPDATE/DELETE of posted rows, no late-leg/reopen via
`age(xmin)=0`, immutable account identity, immutable completed idempotency keys); and the restricted
**`billing.ledger_post(jsonb)` SECURITY DEFINER** function (owner `telvyn_ledger_fn`, hardened
`search_path`, PUBLIC EXECUTE revoked, EXECUTE only to `telvyn_app`). Role model (R6): runtime
`telvyn_app` has **EXECUTE on `ledger_post` only — no direct DML/SELECT** on ledger tables
(grant scripts exclude them); the function owner `telvyn_ledger_fn` holds minimal DML (no
UPDATE/DELETE on posted history). Deployment uses a temporary ownership-transfer lifecycle
(`ledger-migration-pre.sql`/`-post.sql`, fail-closed cleanup) wired into CI. **`prisma db push`
prohibited** on the ledger DB; after financial data exists, recovery is **forward-only**. RLS on
ledger tables stays **deferred (ADR-0005), NOT active** — application-layer read isolation today.
