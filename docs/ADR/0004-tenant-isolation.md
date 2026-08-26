# ADR-0004 — Tenant isolation: server-derived context + mandatory data-layer scoping (RLS as defense-in-depth)

- **Status:** Accepted
- **Date:** 2026-08-27
- **Deciders:** Architect (owner authorized by ordering the authorization foundation)
- **Resolves:** DB-002 (CRITICAL) / SEC-001 (CRITICAL)

## Context

The constitution mandates tenant isolation "in the data layer, not just
application code," and "never trust tenant IDs supplied by clients." Two
mechanisms were on the table (DB-002): application-scoped `WHERE tenant_id`
vs PostgreSQL Row-Level Security. Prisma does not natively thread a per-request
tenant into every query, and RLS with a pooled connection needs `SET LOCAL`
inside a transaction against a non-BYPASSRLS role — powerful but heavier.

## Decision

**Defense in depth, two enforced layers, tenant id ALWAYS derived server-side:**

1. **Server-derived tenant context (never client-supplied).** The active
   `tenantId` is resolved at login from the user's `Membership`, stamped into
   the `Session` and the access-token `tid` claim, and re-verified against a
   live membership on every request. Request bodies/params/query never provide
   a tenant id for scoping — any such value is ignored.

2. **Mandatory data-layer scoping (choke point).** A Prisma client extension
   wraps every operation on a tenant-owned model and injects the context
   `tenantId` into the `where`/`create data`. If a tenant-owned model is
   queried with **no** tenant context, the extension **throws** (deny by
   default) — "forgot to scope" becomes a loud failure, not a silent leak.
   This is the single path all request handlers use.

3. **PostgreSQL RLS (FORCE) as defense-in-depth.** A raw-SQL migration enables
   `ENABLE/FORCE ROW LEVEL SECURITY` with `USING (tenant_id = current_setting
   ('app.tenant_id')::uuid)` on tenant-owned tables, and the request runs under
   a non-BYPASSRLS role with `SET LOCAL app.tenant_id`. This is the belt to the
   application layer's suspenders; it is enabled at deploy (Phase 20 / DEVOPS)
   and is documented in DATABASE.md. The application layer alone is sufficient
   for correctness; RLS guarantees that even a bug in the app layer cannot leak.

## Authorization model

- **RBAC, deny-by-default.** Permissions are `resource.action` strings
  (`did.read`, `role.manage`…), grouped into permission groups, granted to
  roles, roles assigned to a `Membership` (user-in-tenant). System roles
  (`tenantId = null`, `isSystem = true`) are shared templates; **custom roles**
  are tenant-scoped rows. Wildcards (`did.*`, `*`) are supported for grants.
- Every route declares required permissions; the permission guard checks the
  context permission set. Object-level checks (IDOR) are the tenant scope plus
  ownership in the query — a resource id from another tenant resolves to 404.

## Consequences

- DB-002/SEC-001 closed. `User.tenantId` (reserved in ADR-0003) becomes the
  user's **primary/home tenant** — the Phase 3 migration is additive.
- Access tokens gain a `tid` claim; Phase-2 sessions gain `tenantId`
  (additive, nullable — a tenant-less session simply fails tenant-scoped routes).
- The scoped Prisma extension is the only sanctioned data path for tenant-owned
  models; unit tests assert the injection + deny-without-context behavior, and
  e2e tests assert cross-tenant/IDOR/privilege-escalation are refused.
