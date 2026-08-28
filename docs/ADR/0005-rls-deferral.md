# ADR-0005 — PostgreSQL RLS: deferred as staged defense-in-depth

- **Status:** Accepted
- **Date:** 2026-08-29
- **Deciders:** Architect / Security (pre-Phase-12 hardening)
- **Related:** ADR-0004 (tenancy & app-layer scoping), SEC-001, audit P2-2

## Context

The pre-Phase-12 hardening pass evaluated whether to make PostgreSQL
Row-Level Security (RLS) operative now. RLS would be **defense-in-depth** — a
database-level guarantee that even an application bug cannot leak across
tenants. The application authorization layer (ADR-0004) remains mandatory and
is the primary control; RLS is never a replacement for it.

### What already protects tenant data (verified)

- Tenant context is derived **server-side** from the session `tid` claim and a
  re-verified live membership — never from client input.
- A Prisma client extension (`prisma.scoped.*`) injects `tenantId` into every
  operation on tenant-owned models and **throws on unscoped access**
  (deny-by-default); unique reads resolve a foreign id to 404.
- The `authz.e2e` suite proves cross-tenant isolation, IDOR, and
  privilege-escalation refusal (22 e2e green).

### Tenant-sensitive tables

`Membership`, `Role`, `AuditLog` carry a `tenantId` and are the RLS targets
(already enumerated in `apps/api/prisma/rls/enable-rls.sql`, with
`FORCE ROW LEVEL SECURITY` + a `current_setting('app.tenant_id')` policy).
Join tables (`MembershipRole`, `RolePermission`) have no direct `tenantId` and
would need policy sub-selects — out of scope for a first cut.

## Decision

**Defer RLS activation.** Keep `enable-rls.sql` as the staged, idempotent
artifact but do **not** wire it into the running system yet. The app-layer
scoped client is the sufficient, tested isolation control at this stage
(single tenant per request, no background workers, no cross-tenant reporting).

## Blockers (why "now" is not safe)

1. **App runs as the table-owner role.** RLS is bypassed by table owners
   unless `FORCE` is set (it is), but correct production RLS needs a dedicated
   **NOBYPASSRLS** application role with explicit `GRANT`s — which does not
   exist yet (dev connects as owner `telvyn`).
2. **Per-transaction GUC wiring is a real data-layer change.** RLS policies
   read `current_setting('app.tenant_id')`, which must be `SET LOCAL` on the
   **same connection** as the query, inside a transaction. Prisma pools
   connections, so every tenant-scoped operation would have to run inside
   `prisma.$transaction(tx => { tx.$executeRaw`SET LOCAL app.tenant_id=…`; … })`.
   That refactors the scoped-client hot path and risks the verified baseline
   for marginal benefit today.
3. **System/admin/worker access is undesigned.** No background workers or
   cross-tenant reporting exist yet; when they do they need a defined
   elevated/bypass path. Enabling RLS before that path exists would either
   block those operations or force premature design.

## Staged implementation plan (revisit before multi-worker / prod launch)

1. Create a `telvyn_app` role `NOBYPASSRLS`; move the API connection to it;
   `GRANT` DML on the tenant tables. Keep migrations/seed on an owner role.
2. Add a transaction-scoped data path that issues `SET LOCAL app.tenant_id`
   from the server-derived context before tenant-owned queries; route the
   scoped client through it. Prove Prisma compatibility under pooling.
3. Apply `enable-rls.sql` in the deploy pipeline **after** `migrate deploy`.
4. Add tests: (a) a raw query with no `app.tenant_id` returns **0 rows**;
   (b) cross-tenant read returns 0 rows at the DB layer; (c) system/admin and
   any worker paths still function; (d) transactions and the existing e2e
   suite stay green.
5. Document the elevated/bypass path for legitimate cross-tenant operations.

## Consequences

- No change to the running system now; the verified app-layer isolation
  remains the control. Risk to the baseline avoided.
- RLS remains a tracked P2 with a concrete activation plan, not an open
  hand-wave. The audit finding is answered with an explicit decision, not a
  forced checkbox.
