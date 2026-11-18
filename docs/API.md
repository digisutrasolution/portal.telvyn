# API.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**No API, no OpenAPI spec, no endpoints exist.**

## Principles — PLANNED (locked by constitution)

- Contract-first: OpenAPI 3 authored & reviewed before implementation;
  clients/types generated, never hand-written
- Versioned base path `/v1/...`; JSON; RFC 7807 `application/problem+json` errors
- Boundary validation of ALL input; deny-by-default permission check per route
- `Idempotency-Key` honored on all money/provisioning mutations
- Cursor pagination for list endpoints
- Rate limiting on auth + public surfaces

## Resource map — PROPOSED (draft; ratify with the domain ADRs)

| Resource | Operations |
|---|---|
| /v1/auth | login, refresh, logout, MFA enroll/verify |
| /v1/users, /v1/roles | identity & RBAC admin |
| /v1/dids | search inventory, order, assign, release |
| /v1/dids/{id}/routing | get/set delivery configuration |
| /v1/porting | port-in/out requests & status |
| /v1/carriers | upstream provider management (admin) |
| /v1/cdrs | CDR listing (filtered, paginated) |
| /v1/wallet or /v1/invoices | billing surface — **depends on UNKNOWN billing model** |
| /v1/audit-logs | audit trail (admin) |

## UNKNOWN

- API framework & runtime (ADR-0002)
- Webhook surface (carrier callbacks, customer notifications)
- Public-API exposure for customers (portal-only vs API keys)

---

## Telecom platform infrastructure — EXISTING (Phase 12D, 2026-08-29)

Platform-only telecom infra. Guard stack on every route:
`JwtAuthGuard → TenantGuard → PlatformGuard → PermissionGuard`. `PlatformGuard`
requires the caller's active tenant to be `PLATFORM` — a customer/reseller
tenant is refused (403) even if its role holds `*`. Mutations are audited via
the existing `AuditService`. None of these resources hold secrets.

| Method & path | Permission |
|---|---|
| `GET /v1/telecom/regions` · `GET /v1/telecom/regions/:id` | `telecom.read` |
| `POST/PUT/DELETE /v1/telecom/regions[/:id]` | `telecom.manage` |
| `GET /v1/telecom/engines` · `GET /v1/telecom/engines/:id` | `telecom.read` |
| `POST/PUT/DELETE /v1/telecom/engines[/:id]` · `PUT /v1/telecom/engines/:id/capabilities` | `telecom.manage` |
| `GET /v1/telecom/engines/:id/status` | `telecom.health.read` |
| `POST /v1/telecom/engines/:id/health-check` | `telecom.health.read` |
| `POST /v1/telecom/engines/:id/sync` | `telecom.manage` |
| `POST /v1/telecom/engines/:id/sync/rollback` | `telecom.manage` |
| `GET /v1/telecom/engines/:engineId/assignments` | `telecom.read` |
| `POST /v1/telecom/engines/:engineId/assignments` (`{kind, resourceId}`) | `telecom.manage` |
| `PATCH /v1/telecom/engines/:engineId/assignments/:assignmentId` (`{enabled}`) | `telecom.manage` |
| `DELETE /v1/telecom/engines/:engineId/assignments/:assignmentId` | `telecom.manage` |
| `GET /v1/telecom/nodes` · `GET /v1/telecom/nodes/:id` | `telecom.read` |
| `GET /v1/telecom/nodes/:id/health` | `telecom.health.read` |
| `POST/PUT/DELETE /v1/telecom/nodes[/:id]` | `telecom.manage` |

Engine GET is enriched with honest adapter metadata (ADR-0007): `implemented`
(false until a real integration), `softwareCapabilities` (the engine's declared
profile), `capabilities` (admin-enabled per instance), and live `health`
(UNKNOWN via the stub). Node `health` starts UNKNOWN (populated by the health
framework, 12I).

**Engine foundation (Phase 12K, ADR-0007 addendum).** `GET :id/status` returns a
normalized `EngineStatus` — `provider`, `implemented`, an explicit
`capabilities` *operation profile* (`health`/`routing`/`registration`/
`activeCalls`/`originate`/`configuration` — Kamailio `originate:false`,
Asterisk/FreeSWITCH `originate:true`), honest `health` (`UNKNOWN` for stubs,
never fabricated `HEALTHY`), a `correlationId`, and `checkedAt`. `POST :id/sync`
attempts to push control-plane config to the engine and, with stub adapters,
returns **HTTP 501** (normalized `NOT_IMPLEMENTED` — no fake success); the attempt
is always audited as `telecom.engine.sync_attempted` (metadata: outcome, code,
correlationId, provider — no secrets). Both are **platform-only** (`PlatformGuard`);
a customer tenant gets 403 even as owner. Normalized failure mapping:
`NOT_IMPLEMENTED → 501`, `TIMEOUT → 504`, else `503`. Credentials never appear in
any response — config sync carries only `credentialRef` ids.

**Engine runtime foundation (Phase 12L, ADR-0011).** `GET :id/status` additionally
returns `connection` (SSRF-guarded reachability: `UNCONFIGURED`/`DISABLED`/
`BLOCKED`/`UNVERIFIED`/`REACHABLE`/`UNREACHABLE`, `endpointConfigured`, safe
`detail`) and `version` (`desiredVersion`, `appliedVersion` — **`null`** until a
real engine applies, `syncState` ∈ `APPLIED`/`PENDING_RECONCILIATION`/`null`
(Phase 12N-4a), `versions` count). `POST :id/health-check` actively probes
(honest `UNKNOWN` with the NullConnector — no egress), records a `HealthEvent` on
transition, and audits `telecom.engine.health_checked`. `POST :id/sync` is now
**versioned** (deterministic secret-free config fingerprint = desired version),
**idempotent**, and **concurrency-guarded** (a second concurrent sync → **409**;
Redis-lock outage → **503**), still honest `501 NOT_IMPLEMENTED`, audited with
`desiredVersion`/`appliedVersion`/`syncState`. The response carries `syncState`
(Phase 12N-4a): success → `APPLIED` (applied version advances); a **TIMEOUT** →
`PENDING_RECONCILIATION` (engine state unknown — applied is **never** advanced);
any other failure → `FAILED` (no snapshot, retryable). With a real connector wired
(Phase 12N-4b, ADR-0013) the apply is a Kamailio **htable diff-and-apply** verified
by a re-dump (`OK` only when it matches; `APPLY_INCOMPLETE`/`INVALID_CONFIG`/`UNAVAILABLE`
otherwise); off by default (`NullEngineConnector` → `NOT_IMPLEMENTED`/501). `POST :id/sync/rollback` re-proposes the prior
desired version (append-only; **400** when there is no previous version), audited
`telecom.engine.rollback_attempted`. The management **endpoint** on engine
create/update is SSRF-validated (private/loopback/metadata/malformed → **400**).
All runtime endpoints are platform-only.

**Desired config from assignments (Phase 12N-3).** `GET :id/status` now also returns
`desired` — a live, read-only preview of the engine's desired configuration built
from its ENABLED resource assignments: `{ version (short secret-free fingerprint),
summary: { carriers, trunks, dids, routes } }`. Disabling/unassigning a resource (or
soft-deleting the resource) drops it from the intent and changes the fingerprint.
`POST :id/sync` records this same non-empty desired version; nothing is pushed yet
(the connector still returns honest `NOT_IMPLEMENTED` until a real `applyConfiguration`).

**Engine resource assignments (Phase 12N-2, ADR-0012).** Platform-only CRUD for
which resources deploy to an engine. `POST …/assignments` takes `{kind, resourceId}`
(`kind` ∈ `SIP_TRUNK`/`DID`/`ROUTING_PROFILE`); the resource is validated against
the table implied by `kind` (missing → **404**), and `tenantId` is derived from the
resource's owner — **never client-supplied**. A resource already assigned to the
engine → **409**; re-assigning a previously-unassigned resource reactivates it.
`PATCH …/:assignmentId {enabled}` toggles without removing; `DELETE …/:assignmentId`
soft-unassigns (**204**). PlatformGuard (customer **403**, unauth **401**); every
mutation audited (`telecom.engine.resource_{assigned,assignment_updated,unassigned}`).
No config is pushed — assignments feed the desired intent in a later sub-phase. Lists are bounded (take 500); cursor pagination lands with the
high-cardinality tenant resources (DIDs, 12G). **Note:** the hand-authored
OpenAPI YAML currently covers `/v1/auth` only; authz + telecom endpoints are
documented here (pre-existing gap, tracked — YAML expansion is future work).

## Carrier API — EXISTING (Phase 12E, 2026-08-29)

`/v1/telecom/carriers` — JWT + tenant + permission gated; system-vs-tenant scope
enforced in the service (not a client field). Mutations audited (credentialId
reference only, never the secret).

| Method & path | Permission |
|---|---|
| `GET /v1/telecom/carriers` (cursor pagination; filters `status`, `regionId`, `scope=all\|system\|tenant`, `q`) | `carrier.read` |
| `GET /v1/telecom/carriers/:id` | `carrier.read` |
| `POST /v1/telecom/carriers` (inline `credential` XOR `credentialId`) | `carrier.create` |
| `PATCH /v1/telecom/carriers/:id` | `carrier.update` |
| `DELETE /v1/telecom/carriers/:id` (soft delete) | `carrier.delete` |

Response is a safe DTO: `scope` (SYSTEM/TENANT, computed), config fields, a safe
`credential` summary (`id`, type, label, hint, scope — never the secret), and
honest `health` (UNKNOWN). Routing note: telecom resources live under
`/v1/telecom/*` (12D convention) rather than the prompt's `/v1/carriers` example.
OpenAPI YAML still covers `/v1/auth` only (tracked debt) — endpoints documented here.

## SIP trunk API — EXISTING (Phase 12F, 2026-08-29)

`/v1/telecom/sip-trunks` — JWT + tenant + permission gated; strictly tenant-owned
(auto-scoped). Mutations audited (carrierId/credentialId/transport/direction
references only — never secrets).

| Method & path | Permission |
|---|---|
| `GET /v1/telecom/sip-trunks` (cursor pagination; filters `status`, `direction`, `transport`, `carrierId`, `q`) | `sip_trunk.read` |
| `GET /v1/telecom/sip-trunks/:id` | `sip_trunk.read` |
| `POST /v1/telecom/sip-trunks` (inline `credential` XOR `credentialId`) | `sip_trunk.create` |
| `PATCH /v1/telecom/sip-trunks/:id` | `sip_trunk.update` |
| `DELETE /v1/telecom/sip-trunks/:id` (soft delete) | `sip_trunk.delete` |

Response is a safe DTO (config + carrier summary + safe credential metadata +
honest `health: UNKNOWN`) — never `secretEnc`/passwords. OpenAPI YAML still
covers `/v1/auth` only (tracked debt) — endpoints documented here.

> **OpenAPI debt — partial closure (Phase 12O-2f/2g/2h, 2026-11-18):** the
> contract now also covers `GET /v1/me/context`, `GET /v1/telecom/engines`,
> `GET /v1/telecom/engines/{id}`, `GET /v1/telecom/engines/{id}/status`,
> `GET /v1/telecom/regions`, `GET /v1/telecom/nodes`, and the engine POST actions
> `.../{id}/health-check`, `.../{id}/sync`, `.../{id}/sync/rollback` (+ the
> `Engine`/`EngineHealth`/`EngineCapabilities`/`EngineStatus`/`EngineConnection`/
> `EngineVersionPosture`/`EngineDesiredPreview`/`Region`/`Node`/`NodeHealth`/
> `EngineHealthReport`/`SyncOutcome` schemas), authored from the real service
> shapes so the NOC frontend can generate its types (ADR-0018/0019). The
> remaining telecom/authz endpoints are still documented here only; each is added
> to the contract as a frontend screen consumes it.

## DID API — EXISTING (Phase 12G, 2026-08-29)

`/v1/telecom/dids` — JWT + tenant + permission gated; strictly tenant-owned
(auto-scoped). Mutations audited (didId/e164/carrierId/sipTrunkId/
routingProfileId/regionId/status — never secrets, never embedded objects).

| Method & path | Permission |
|---|---|
| `GET /v1/telecom/dids` (cursor pagination; filters `status`, `carrierId`, `sipTrunkId`, `routingProfileId`, `regionId`, `country`, `q`) | `did.read` |
| `GET /v1/telecom/dids/:id` | `did.read` |
| `POST /v1/telecom/dids` (raw `number` → canonical E.164; optional carrier/trunk/profile/region) | `did.manage` |
| `PATCH /v1/telecom/dids/:id` (relations nullable to detach; number immutable) | `did.manage` |
| `DELETE /v1/telecom/dids/:id` (soft delete) | `did.manage` |

Response DTO: e164 (canonical), country (derived), status, reference ids, honest
`health: UNKNOWN`. Duplicate number → 409. RBAC note: 12B provides
`did.read`/`did.assign`/`did.manage` (not `.create`/`.update`/`.delete`) — reused
read+manage; no duplicates. OpenAPI YAML still `/v1/auth` only (tracked debt).

## Routing profile API — EXISTING (Phase 12H, 2026-08-29)

`/v1/telecom/routing-profiles` — JWT + tenant + permission gated; strictly
tenant-owned (auto-scoped). Rules are embedded (`rules` array; PATCH replaces).
Audit records counts/status only (never webhook payloads/secrets).

| Method & path | Permission |
|---|---|
| `GET /v1/telecom/routing-profiles` (cursor pagination; filters `status`, `direction`, `q`) | `routing.read` |
| `GET /v1/telecom/routing-profiles/:id` | `routing.read` |
| `POST /v1/telecom/routing-profiles` (with `rules[]`) | `routing.manage` |
| `PATCH /v1/telecom/routing-profiles/:id` (present `rules` replaces the set) | `routing.manage` |
| `DELETE /v1/telecom/routing-profiles/:id` (soft delete) | `routing.manage` |

Rule fields: `destinationType`, `destination` (validated per type; webhooks
SSRF-checked, never called), `priority` (deterministic order), `enabled`,
`timeoutSeconds`, `retryCount`, `carrierId`, `failoverDestination`,
`failoverAfterSeconds`, `schedule {timezone, daysOfWeek[], startMinute,
endMinute}`. Duplicate name per tenant → 409. RBAC reuses `routing.read`/
`routing.manage` (12B — not `routing_profile.*`). OpenAPI YAML still `/v1/auth`
only (tracked debt).

## Routing policy fields — EXISTING (Phase 12I, 2026-08-29)

The `/v1/telecom/routing-profiles` body (12H) now also accepts **policy** fields:
`selectionStrategy`, `failoverEnabled`, `failoverConditions[]`, `maxAttempts`,
`overallTimeoutSeconds`; rules gain `weight`, `failoverDestination` +
`failoverDestinationType`. Responses include `version` and a `policy` object.
PATCH accepts optional `expectedVersion` (optimistic concurrency → **409** on
mismatch); list adds a `strategy` filter. No new routes; no runtime execution.
OpenAPI YAML still `/v1/auth` only (tracked debt).

## LCR policy API — EXISTING (Phase 12J, 2026-08-29)

`/v1/telecom/lcr-policies` — JWT + tenant + permission gated; strictly
tenant-owned (auto-scoped). Reuses `routing.read`/`routing.manage`. Routes are
embedded (`routes[]`; PATCH replaces). Response returns `candidates` in
deterministic selection order + `version`.

| Method & path | Permission |
|---|---|
| `GET /v1/telecom/lcr-policies` (cursor pagination; filters `enabled`, `strategy`, `q`) | `routing.read` |
| `GET /v1/telecom/lcr-policies/:id` | `routing.read` |
| `POST /v1/telecom/lcr-policies` (with `routes[]`) | `routing.manage` |
| `PATCH /v1/telecom/lcr-policies/:id` (optional `expectedVersion` → 409; present `routes` replaces) | `routing.manage` |
| `DELETE /v1/telecom/lcr-policies/:id` (soft delete) | `routing.manage` |

Route fields: `carrierId`, `sipTrunkId?`, `prefix`, `country?`, `costMicros`
(integer micro-units), `currency`, `priority`, `weight?`, `enabled`,
`effectiveFrom?/To?`. Duplicate name → 409; foreign/deleted carrier/trunk → 400.
No new permission created (routing.manage reused). OpenAPI YAML still `/v1/auth`
only (tracked debt).

## Identity & authorization context — EXISTING (Phase 12O-2a, 2026-11-18)

`GET /v1/me/context` — the self-scoped "whoami" the frontend calls at bootstrap
(before it knows any permissions) to drive permission-aware navigation and
route authorization. **No permission is required** beyond an authenticated
session with a live, active membership (JwtAuthGuard + TenantGuard); there is
deliberately no `@RequirePermissions` — gating on a permission would be a
chicken-and-egg. All fields derive from the server-built tenant context
(ADR-0004); no client-supplied tenant id is ever read, so there is no IDOR
surface. See ADR-0014.

| Method & path | Auth |
|---|---|
| `GET /v1/me/context` | authenticated session + active membership (no permission) |

Response: `{ userId, tenantId, tenantType (PLATFORM\|RESELLER\|CUSTOMER), roles[{id,key,name,isSystem}], permissions[] }`.
`permissions` are the **expanded concrete** keys (wildcards such as owner's `*`
resolved), sorted — never the raw wildcard. `401` unauthenticated; `403` when
the session has no active tenant/membership. Read-only; the server guards remain
the authority — the frontend uses this only for UX gating. Contract: `MeContext`
in `telvyn.v1.yaml`.
