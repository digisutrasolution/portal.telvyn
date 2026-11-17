# ADR-0014 — Authorization context endpoint (`GET /v1/me/context`)

- **Status:** Accepted (owner-authorized Phase 12O-2a; implemented 2026-11-18)
- **Date:** 2026-11-18
- **Deciders:** Architect / Security
- **Related:** ADR-0004 (tenant isolation: server-derived context), ADR-0002
  (frontend stack / contract-first). Prerequisite for the NOC auth frontend
  (Phase 12O-2b+).

## Context

The frontend (Next.js shell) has no session or data layer yet. To build
permission-aware navigation and route authorization it must, right after login,
learn **who the user is acting as**: the active tenant, the tenant's type
(platform vs reseller/customer — this gates the whole NOC/engine surface), the
membership's roles, and the concrete permission keys the session holds.

None of the existing endpoints provide this:

- `GET /v1/auth/me` returns identity only (`id, email, fullName, mfaEnabled,
  emailVerified`) — no tenant, roles, or permissions.
- `GET /v1/permissions` returns the permission **catalog** (every permission that
  exists) and itself requires `role.read` — it is not the user's granted set.
- The user's real permission set and `tenantType` exist only server-side, in the
  request-scoped `TenantContext` built by `TenantGuard` from the session's `tid`
  claim; they are never surfaced to the client.

## Decision

Add one read-only endpoint, `GET /v1/me/context`, returning the current
session's server-derived authorization context:

```
{ userId, tenantId, tenantType, roles: [{id,key,name,isSystem}], permissions: string[] }
```

- **No permission gate.** It carries no `@RequirePermissions`. Gating it on a
  permission would be a chicken-and-egg: the frontend calls it precisely to
  discover its permissions. `JwtAuthGuard` + `TenantGuard` still apply, so a
  caller must have an authenticated session **and** a live, active membership on
  an active tenant; a tenant-less session gets `403` (consistent with every
  other tenant-scoped route). `401` when unauthenticated.
- **Self-scoped, no IDOR.** Every field comes from the server-built
  `TenantContext` (ADR-0004). No path/query/body input is read, so a caller can
  never request another user's or tenant's context.
- **Expanded, concrete permissions.** `permissions` is the expanded set (owner's
  `*` and any `x.*` resolved to real keys), sorted — never the raw wildcard — so
  the frontend compares plain keys and can memoize deterministically.
- **UX only; server stays authoritative.** The frontend uses this for nav/route
  gating alone. Every mutating/read route keeps its own `@RequirePermissions` +
  `PlatformGuard` checks; this endpoint never becomes an authorization decision
  point.

## Options considered

1. **Extend `GET /v1/auth/me`** to include tenant/roles/permissions. Rejected —
   it is the identity contract (used by non-tenant flows too) and conflates
   identity with the tenant-scoped authorization context; the two have different
   guards (`/auth/me` needs no active tenant).
2. **Reuse `GET /v1/permissions`.** Rejected — it is the catalog, not the grant
   set, and requires `role.read`, which the bootstrap call cannot assume.
3. **Dedicated `GET /v1/me/context` (chosen).** Minimal, additive, self-scoped,
   and the natural home for "what can this session do".

## Consequences

- Additive only: a new `TenancyService.memberContext`, one route on
  `AuthzController`, and the `MeContext` schema in `telvyn.v1.yaml`. No schema
  change, no migration, no DI-default change, and **no change to API auth
  behavior**.
- The roles lookup uses the base Prisma client (not the tenant-scoped one) so
  **system roles** (`tenantId = null`) held by the membership are included; the
  query is still bounded to `ctx.membershipId`, so no cross-tenant data is
  reachable.
- Covered by e2e cases in `authz.e2e.test.ts` (unauthenticated `401`; owner
  shape with expanded, wildcard-free, sorted permissions; operator reads but
  lacks `*.manage`; no cross-tenant leakage).
- Enables Phase 12O-2b+ (typed API client, session provider, permission-aware
  nav) without any further backend prerequisite for read-only gating.
