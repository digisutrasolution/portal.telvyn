# ADR-0008 — Carrier abstraction: platform/wholesale vs tenant

- **Status:** Accepted
- **Date:** 2026-08-29
- **Deciders:** Architect / Telecom (Phase 12A)
- **Related:** ADR-0004 (tenancy & scoping), ADR-0009

## Context

A carrier (upstream SIP provider) may be either a **platform/wholesale**
carrier owned by the operator (`tenantId = null`) and usable across the
platform, or a **tenant-specific** carrier owned by one customer. This is the
same dual-nature shape already used by `Role` (system role `tenantId = null`
vs tenant custom role), where the audit noted the scoped Prisma client cannot
express "my-tenant OR system" and `RolesService` fell back to the raw client
with manual `OR` filters (a fragile pattern, audit P3-2).

## Decision

- `Carrier.tenantId` is **nullable**: null = platform/wholesale, set = tenant
  carrier. `CarrierSipEndpoint` is a child of `Carrier`.
- Introduce a **"system-or-tenant" read mode** in the tenant-scope layer (a
  documented, unit-tested helper) so dual-nature reads (`tenantId = ctx OR
  tenantId IS NULL`) are expressed **once**, safely, instead of scattering raw
  `OR` filters. This also retrofits `Role` onto the same helper, closing P3-2.
- **Writes are never system-or-tenant.** Creating/updating/deleting a
  platform/wholesale carrier (`tenantId = null`) requires the caller's active
  tenant to be `type = PLATFORM` plus the platform carrier permission
  (enforced by a `@PlatformScope()`-style check). A customer tenant may only
  create/mutate carriers under its own `tenantId`.
- Reads return the union (platform + own) so a tenant can *select* a wholesale
  carrier without being able to *mutate* it.
- **Priority / capacity (CPS, concurrent) are configuration.** LCR (least-cost
  routing) selection logic is explicitly **out of scope** for Phase 12.

## Consequences

- One tested code path for dual-nature isolation; the fragile per-service `OR`
  filtering is removed.
- Cross-tenant carrier access is impossible: a tenant sees platform carriers +
  its own, never another tenant's, and cannot mutate platform carriers.
- The model is ready for wholesale/reseller economics without committing to
  routing/LCR now.
