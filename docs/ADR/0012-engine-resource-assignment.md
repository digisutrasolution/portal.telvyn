# ADR-0012 — Engine ↔ resource assignment model

- **Status:** Accepted
- **Date:** 2026-11-17
- **Deciders:** Architect / Telecom (Phase 12N)
- **Related:** ADR-0006 (control vs data plane), ADR-0007 (engine abstraction),
  ADR-0011 (engine runtime integration boundary)

## Context

Phase 12M delivered a real, live-proven engine *health* connector, but an
engine's desired configuration intent (`EngineConfigurationIntent`, ADR-0007) is
still empty — there is no model of **which telecom resources are deployed to
which engine**. Without it, `buildConfigurationIntent` can only produce an empty
intent, and a real `applyConfiguration` has nothing to push. This ADR records how
that assignment is modelled.

## Decision

- **A single `EngineResourceAssignment` table**, platform-managed (PlatformGuard),
  linking a `TelecomEngine` to one deployable resource. Assignable kinds
  (`EngineResourceKind`): `SIP_TRUNK`, `DID`, `ROUTING_PROFILE` — the resources a
  SIP router (Kamailio, `originate:false`) actually needs. **Carriers are NOT
  directly assignable**: a carrier is reached *via* a trunk, so it is implied by
  the assigned trunk, not deployed on its own.

- **Real foreign keys, never a polymorphic id.** The constitution forbids FK-less
  tables, so instead of a `(resourceType, resourceId)` pair the table has three
  explicit nullable FKs (`sipTrunkId`, `didId`, `routingProfileId`), each
  `ON DELETE CASCADE`, plus the engine FK (Cascade) and a denormalized `tenantId`
  FK (the resource's owner; null = platform resource) for scope + audit.

- **Exactly-one-resource-matching-kind, enforced in the database.** A CHECK
  constraint guarantees precisely one resource FK is set and that it matches
  `kind`, so no code path can persist an ambiguous assignment. Per-kind partial
  uniqueness (`@@unique([engineId, sipTrunkId])`, etc.; NULLs distinct in
  Postgres) means a given resource is assigned to an engine at most once.

- **`enabled` + soft delete.** An assignment can be disabled without deletion;
  the desired intent (future 12N-3) is built only from `enabled`, non-deleted
  rows whose resource is itself not soft-deleted.

- **Platform-scoped, additive, no behavior change yet.** 12N-1 adds only the
  schema. The assignment API/RBAC/audit (12N-2) and the intent wiring (12N-3)
  follow as separate, review-gated sub-phases; a real `applyConfiguration` +
  applied-version persistence (ADR-0011) remains deferred to 12N-4.

## Consequences

- The desired configuration of an engine becomes expressible as data, enabling a
  non-empty, secret-free `EngineConfigurationIntent` and a meaningful config
  fingerprint once the intent builder reads assignments (12N-3).
- Deleting an engine or a resource cleans up assignments automatically (Cascade);
  disabling is reversible via `enabled`.
- Assignment is a platform operation: deciding which tenant/platform resources a
  shared engine serves is not a tenant-self-service action.
