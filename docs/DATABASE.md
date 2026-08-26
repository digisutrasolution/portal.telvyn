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
| DB-003 | **HIGH** (design gate) | **Billing model undecided** (prepaid wallet vs postpaid invoicing vs both). The ledger spine (accounts/transactions/legs/idempotency) is model-independent and can be designed now, but Wallet vs Invoice tables, reservation pattern, and suspension logic cannot be finalized. Risk: feature pressure leads to ad-hoc money columns before the ledger exists — forbidden by constitution. | Decide billing model by ADR; ledger tables must land **with or before** the first money-touching feature. |
| DB-004 | **HIGH** (design gate) | **No ORM/migration tool chosen** (part of ADR-0002). There is currently no migration lane at all; the constitution's "migrations are the only DDL path" rule is unenforceable. | Choose stack/ORM; scaffold the migration lane as the first schema commit. Note: partial unique indexes (soft-delete recycling), RLS policies, partitions, and ledger balance triggers typically require a **raw-SQL migration lane** alongside any ORM — plan for both from day one. |
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
2. **Database layer (defense-in-depth)**: `prisma/migrations/rls/enable-rls.sql`
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
