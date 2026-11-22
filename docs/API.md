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
| `GET /v1/telecom/engines/:id/health-events` (health history; cursor pagination) | `telecom.health.read` |
| `GET /v1/telecom/engines/:id/config-versions` (config-version history; cursor pagination) | `telecom.health.read` |
| `POST /v1/telecom/engines/:id/sync` | `telecom.manage` |
| `POST /v1/telecom/engines/:id/sync/rollback` | `telecom.manage` |
| `GET /v1/telecom/engines/:engineId/assignments` | `telecom.read` |
| `POST /v1/telecom/engines/:engineId/assignments` (`{kind, resourceId}`) | `telecom.manage` |
| `PATCH /v1/telecom/engines/:engineId/assignments/:assignmentId` (`{enabled}`) | `telecom.manage` |
| `DELETE /v1/telecom/engines/:engineId/assignments/:assignmentId` | `telecom.manage` |
| `GET /v1/telecom/nodes` · `GET /v1/telecom/nodes/:id` | `telecom.read` |
| `GET /v1/telecom/nodes/:id/health` | `telecom.health.read` |
| `POST /v1/telecom/nodes/:id/health-check` (operator probe; records a transition) | `telecom.health.read` |
| `GET /v1/telecom/nodes/:id/health-events` (health history; cursor pagination) | `telecom.health.read` |
| `POST /v1/telecom/nodes/:id/heartbeat` (node-agent ingest) | **node-agent mTLS** (no JWT/permission) |
| `POST /v1/telecom/nodes/health/evaluate` (dead-man's-switch tick) | `telecom.manage` |
| `POST /v1/telecom/nodes/:id/credential` (attach/rotate node-agent cert) | `telecom.manage` |
| `DELETE /v1/telecom/nodes/:id/credential` (detach) | `telecom.manage` |
| `POST/PUT/DELETE /v1/telecom/nodes[/:id]` | `telecom.manage` |

Engine GET is enriched with honest adapter metadata (ADR-0007): `implemented`
(false until a real integration), `softwareCapabilities` (the engine's declared
profile), `capabilities` (admin-enabled per instance), and live `health`
(UNKNOWN via the stub). Node `health` starts UNKNOWN.

**Node health probe (Phase 12O-2au — health-framework foundation).** `POST
:id/health-check` (`telecom.health.read`, platform) is the operator-driven start of
the node health framework, mirroring the engine probe. There is no node liveness
connector yet, so it never fabricates HEALTHY: it resolves an honest **posture** from
configuration (`reachability` ∈ `DISABLED` when administratively disabled,
`UNCONFIGURED` with no `hostRef`, else `UNVERIFIED` → `status: UNKNOWN`), writes that
status to the node's 1:1 health snapshot (`latencyMs` null, `lastHeartbeatAt`
untouched — a probe is not a heartbeat), and records an append-only NODE `HealthEvent`
only on a genuine transition. No egress occurs; unknown node → 404; audited
`telecom.node.health_checked`. Returns `NodeHealthReport` `{nodeId, status,
reachability, detail, correlationId, checkedAt}`. A real reachability connector (or
the designed heartbeat/dead-man's-switch ingest) can later replace the posture
resolution without changing this contract; the history read over the NODE events it
now produces is the next slice (12O-2av).

**Node health-event history (Phase 12O-2av).** `GET :id/health-events`
(`telecom.health.read`, platform) returns the append-only history of the node's
honest health-status transitions — the NODE `HealthEvent` rows produced by the
operator probe (`POST :id/health-check`, Phase 12O-2au), recorded only on a genuine
status change. Identical shape and semantics to the engine history (12O-2as): newest
first, cursor-paginated (`HealthEventPage` = `{items, nextCursor}`, uuidv7 id is the
cursor); each item is the same safe `HealthEvent` view — `{id, fromStatus (null on
the first event), toStatus, reason, correlationId, createdAt}` — and never echoes
`entityType`/`entityId`/`tenantId`. An unknown node id is **404**. No schema change —
reuses the `HealthEvent` model and the `HealthEventPage` contract schema; this adds
the read endpoint (`NodeHealthService.history`) only. Nodes have no detail page, so
the NOC Nodes list surfaces it as a per-row "History" dialog (same gate).

**Node heartbeat ingest (Phase 12O-2ba, ADR-0020 slice 2).** `POST :id/heartbeat` is a
**machine** endpoint — a node agent reports liveness. It is **not** behind the human
JWT/tenant/permission guards; its only authentication is the node's `NODE_AGENT`
**mTLS client certificate**, resolved by a single `HeartbeatAuthenticator` seam and
**bound to the node** (the verified cert fingerprint must equal the node's NODE_AGENT
credential's stored fingerprint, so a node can report only its own health). An accepted
beat (HTTP **202**) stamps `NodeHealth.lastHeartbeatAt` **only** — it records no status
transition (the dead-man's-switch evaluator owns those, slice 3). Rate-limited per node
(`node-heartbeat` bucket), fail-closed on a limiter outage (**503**). Unverified → 401,
identity/credential mismatch → 403, unknown node → 404 (checked only after
authentication, so no node-existence oracle). **Fails closed today:** there is no
inbound mTLS terminator in the environment (the app is plain-HTTP behind a
TLS-terminating proxy; the only mTLS is the OUTBOUND engine gateway, ADR-0011), so the
default `NullHeartbeatAuthenticator` yields no identity and **every beat is 401** — the
control plane never trusts a spoofable header/body. A real terminator (app-terminated
TLS socket cert, or a trusted gateway forwarding a verified fingerprint) is a drop-in
replacement of the one seam, exactly like swapping `NullEngineConnector`. Heartbeats are
**not** written to the human audit log (no honest actor; a 30s beat would firehose the
OLTP audit table, ADR-0010) — accept/reject go to the structured logger with the nodeId
+ correlation id. Not consumed by the web client.

**Node health evaluator — dead-man's-switch (Phase 12O-2bb, ADR-0020 slice 3).** `POST
/nodes/health/evaluate` (PLATFORM + `telecom.manage`) runs one evaluator tick — the job
that makes node health **real**. It compares every node's `lastHeartbeatAt` to the
staleness TTL (default 90s, env `NODE_HEARTBEAT_TTL_MS`) and records honest status
transitions: administratively `DISABLED` → `DISABLED`; a heartbeat within the TTL →
`HEALTHY`; otherwise (stale or never seen) → `UNKNOWN`. It **caps at `UNKNOWN`** — silence
never yields `DEGRADED`/`UNHEALTHY` (ADR-0020). A transition is appended to the node's
`HealthEvent` history only on a genuine change (the same rows the operator probe and NOC
"History" read). Multi-instance safe: a Redis `SET NX` lock means only one tick runs at a
time, **fail-closed** — if the lock is held or Redis is down the tick returns
`{skipped: true, reason}` and the next tick retries (never a racing double-write). Returns
`NodeHealthEvaluation` `{skipped, reason?, evaluated, transitioned, correlationId}` (HTTP
200). Triggered by a platform operator or a **dedicated external cron** on the TTL cadence
(the app adds no scheduler dependency). Idle ticks are logged, not audited; a tick that
transitioned ≥1 node writes one bounded audit row (`telecom.node.health_evaluated`) — the
per-node detail lives in `HealthEvent`. **End-to-end today node health still reads
`UNKNOWN`** until a heartbeat is actually accepted (which needs the `NODE_AGENT`
provisioning path + a real inbound mTLS terminator); a `DISABLED` node, however, already
transitions correctly.

**Node-agent credential provisioning (Phase 12O-2bc, ADR-0020).** `POST
:id/credential` (PLATFORM + `telecom.manage`) attaches — or rotates — a node's
`NODE_AGENT` mTLS identity. The body carries the node's **public** client certificate
(`{certificate: <PEM>, label?}`); the **private key stays on the node** and is never
sent. The server parses the cert (invalid → 400), derives its SHA-256 **fingerprint**
(stored as the credential's non-secret `hint` — exactly what the heartbeat ingest
matches), and vaults the certificate (ADR-0009); a prior node-agent credential is
rotated (soft-deleted) so a node has one active identity. `DELETE :id/credential`
detaches (idempotent; the credential row is soft-deleted). The `Node` read now carries a
safe `credential` reference — `{id, type: NODE_AGENT, label, hint (the fingerprint),
scope}` or `null` — **never** the secret. This closes the provisioning gap: once a real
inbound mTLS terminator is wired, a node whose agent presents the matching certificate
can be accepted and (via a heartbeat + the evaluator) reach `HEALTHY`. Audited
(`telecom.node.credential_attached` / `_detached`; the fingerprint is non-secret).

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

**Operator-action status (Phase 12O-2ay).** The operator-action POSTs —
`:id/health-check`, `:id/sync`, `:id/sync/rollback` on engines, and
`:id/health-check` on nodes/carriers — return **HTTP 200 on success** (they are
actions, not resource creations). Failure mappings above (501/504/503/409/400)
are unchanged. Genuine resource-creation POSTs (engine/node/region/carrier/DID/
trunk/routing/LCR) return **201**.

**Engine health-event history (Phase 12O-2as).** `GET :id/health-events`
(`telecom.health.read`, platform) returns the append-only history of the engine's
honest health-status transitions — a `HealthEvent` is recorded only when the status
actually changes (by `POST :id/health-check`). Newest first, cursor-paginated
(`HealthEventPage` = `{items, nextCursor}`; the uuidv7 id is the cursor). Each
`HealthEvent` is a safe view — `{id, fromStatus (null on the first event), toStatus,
reason (safe text, never secrets/raw provider errors), correlationId, createdAt}` —
and never echoes `entityType`/`entityId`/`tenantId`. An unknown engine id is **404**.
No schema change — the `HealthEvent` model existed; this adds the read endpoint
(`EngineHealthService.history`) and authors `HealthEvent`/`HealthEventPage` into the
contract. The NOC engine detail page renders it as a "Health history" timeline.

**Engine config-version history (Phase 12O-2at).** `GET :id/config-versions`
(`telecom.health.read`, platform — consistent with `status`, which already exposes
desired/applied version posture) returns the append-only history of the engine's
desired/applied configuration versions (recorded by `sync` / `rollback` into
`TelecomConfigVersion`). Newest first, cursor-paginated (`ConfigVersionPage`). Each
`ConfigVersion` is a safe view of the secret-free snapshot — `{id, changeType
(CREATE/UPDATE/DELETE/STATUS_CHANGE), kind (desired/applied/reconcile_pending|null),
version (short fingerprint|null), previousVersion (short fingerprint|null), summary
(resource counts|null), actorId, correlationId, createdAt}` — it exposes only the
fingerprint + counts, never the raw config body. No schema change — the model
existed; this adds the read endpoint (`EngineSyncService.history`) and authors
`ConfigVersion`/`ConfigVersionPage`. The NOC engine detail page renders it as a
"Config version history" timeline below the health history.

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
| `POST /v1/telecom/carriers/:id/health-check` (operator probe; records a transition) | `telecom.health.read` |
| `GET /v1/telecom/carriers/:id/health-events` (health history; cursor pagination) | `telecom.health.read` |

Response is a safe DTO: `scope` (SYSTEM/TENANT, computed), config fields, a safe
`credential` summary (`id`, type, label, hint, scope — never the secret), and
honest `health` — now **derived from the latest operator probe** (Phase 12O-2aw;
UNKNOWN until first probed, never fabricated). Routing note: telecom resources live
under `/v1/telecom/*` (12D convention) rather than the prompt's `/v1/carriers` example.

**Carrier health probe (Phase 12O-2aw).** `POST :id/health-check`
(`telecom.health.read`) is the operator-driven start of the carrier health framework,
mirroring the node probe (12O-2au). Unlike nodes, carriers have **no health snapshot
table**, so it is **event-only** (owner-chosen 2026-11-23): there is no carrier
liveness connector yet, so it never fabricates HEALTHY — it resolves an honest
**posture** from configuration (`reachability` ∈ `DISABLED` when administratively
disabled, `UNCONFIGURED` with no `CarrierSipEndpoint`, else `UNVERIFIED` → `status:
UNKNOWN`) and records an append-only CARRIER `HealthEvent` only on a genuine
transition (the event carries the carrier's `tenantId`; `null` for a system carrier).
The carrier's `health` is then **derived** from the latest such event — the carrier
list computes it per page in two bounded queries (a `groupBy` to the newest event id
per carrier, then one fetch; no N+1), and `get` from a single lookup. The carrier is
scope-resolved (own + system), so a foreign/unknown id is **404** (IDOR-safe); no
egress occurs; audited `telecom.carrier.health_checked`. Returns `CarrierHealthReport`
`{carrierId, status, reachability, detail, correlationId, checkedAt}` (HTTP 200). No
schema change — reuses the `HealthEvent` model (`CARRIER` entity). A real reachability
connector can later replace the posture resolution without changing this contract; the
carrier health-event history read is the follow-up slice (12O-2ax, mirroring node 2av).

**Carrier health-event history (Phase 12O-2ax).** `GET :id/health-events`
(`telecom.health.read`) returns the append-only history of the carrier's health-status
transitions — the CARRIER `HealthEvent` rows produced by the operator probe
(`POST :id/health-check`, Phase 12O-2aw), recorded only on a genuine status change.
Identical shape and semantics to the node (12O-2av) and engine (12O-2as) histories:
newest first, cursor-paginated (`HealthEventPage` = `{items, nextCursor}`, uuidv7 id is
the cursor); each item is the same safe `HealthEvent` view — `{id, fromStatus (null on
the first event), toStatus, reason, correlationId, createdAt}` — and never echoes
`entityType`/`entityId`/`tenantId`. The carrier is scope-resolved (own + system) via the
same gate as `get`, so a foreign/unknown id is **404** (IDOR-safe). No schema change —
reuses the `HealthEvent` model and the `HealthEventPage` contract schema; this adds the
read endpoint (`CarrierHealthService.history`) only. Carriers have no detail page, so the
NOC Carriers list surfaces it as a per-row "History" dialog (same `telecom.health.read`
gate).

As of **Phase 12O-2ae** the full carrier surface — list, get, **create, update,
delete** — is authored into the OpenAPI contract (`CreateCarrier` / `UpdateCarrier`
/ `InlineCredentialInput` schemas in `telvyn.v1.yaml`) and the frontend carrier
management screen (create / edit / soft-delete) consumes the generated types.

**Phase 12O-2am** added the inline credential to the carrier form (frontend only — no
contract change; it consumes the `InlineCredentialInput` already authored here). The
form can create and attach a credential inline (`credential` = `{type, label, hint?,
secret}`): the secret is a write-only field (password input, `autoComplete="off"`,
never pre-filled) and goes straight to the vault — the carrier only ever carries back
a non-secret reference. On edit the current credential shows as a reference and a
"Replace credential" toggle reveals the inline fields; leaving it untouched omits
`credential` so the carrier's credential is unchanged. **Still not offered in the UI:**
attaching an *existing* credential by `credentialId` (no credentials-list endpoint
exists to pick from — the field stays available on the API), detaching a credential
(the API has no null for it), and `regionId` (no region picker). The server validates
and vaults; the secret is never returned.

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
honest `health: UNKNOWN`) — never `secretEnc`/passwords.

As of **Phase 12O-2af** the full SIP trunk surface — list, get, **create, update,
delete** — is authored into the OpenAPI contract (`CreateSipTrunk` / `UpdateSipTrunk`
/ `InlineSipCredentialInput` schemas in `telvyn.v1.yaml`) and the frontend SIP trunk
management screen (create / edit / soft-delete) consumes the generated types. The
POST/PATCH/DELETE handlers themselves are unchanged since Phase 12F — no backend
change. `carrierId` is a required create field and is re-validated server-side for
scope accessibility; the UI drives it with a carrier picker (first page of
`listCarriers`). `authMode` is set in the form.

**Phase 12O-2an** added the inline credential to the SIP trunk form (frontend only —
no contract change; it consumes the `InlineSipCredentialInput` already authored here).
It mirrors the carrier credential (2am) but the SIP inline credential has **no `type`
field** — the type is forced `SIP_PASSWORD` server-side — so the form asks only for a
label, optional hint, and the secret. The secret is write-only (password input,
`autoComplete="off"`, never pre-filled) and goes straight to the vault; the trunk
carries back only a non-secret reference. On edit the current credential shows as a
reference with a "Replace credential" toggle; leaving it untouched omits `credential`
so the trunk's credential is unchanged. As with carriers, attaching an *existing*
`credentialId` is not offered (no credentials-list endpoint) and detaching is not
possible (no null for it).

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
read+manage; no duplicates.

As of **Phase 12O-2ag** the full DID surface — list, get, **create, update,
delete** — is authored into the OpenAPI contract (`CreateDid` / `UpdateDid` schemas
in `telvyn.v1.yaml`) and the frontend Numbers management screen (create / edit /
soft-delete) consumes the generated types. The POST/PATCH/DELETE handlers are
unchanged since Phase 12G — no backend change. All three mutations gate on the
single `did.manage` permission. `number` is write-once (create only; normalized to
E.164, `country` derived — neither is a client-trusted field) and immutable on
update; `UpdateDid` relationship refs are nullable (null detaches). The UI drives
carrier / SIP trunk / routing-profile / region (added in **Phase 12O-2ao**) with
pickers (first page of each list — regions via `GET /v1/telecom/regions`; in edit the
current id is shown even when its name isn't loaded, since the DID API returns ids
only, and clearing a picker detaches via an explicit null). **Known gap (not introduced here):** the 12G service
does not enforce status-*transition* rules — `status` is a free administrative field,
so the UI exposes it as a plain select rather than a guarded state machine.

OpenAPI YAML still `/v1/auth` only (tracked debt) for the surfaces not yet closed.

## Routing profile API — EXISTING (Phase 12H, 2026-08-29)

`/v1/telecom/routing-profiles` — JWT + tenant + permission gated; strictly
tenant-owned (auto-scoped). Rules are embedded (`rules` array; PATCH replaces).
Audit records counts/status only (never webhook payloads/secrets).

| Method & path | Permission |
|---|---|
| `GET /v1/telecom/routing-profiles` (cursor pagination; filters `status`, `direction`, `strategy`, `q`) | `routing.read` |
| `GET /v1/telecom/routing-profiles/:id` | `routing.read` |
| `POST /v1/telecom/routing-profiles` (with `rules[]`) | `routing.manage` |
| `PATCH /v1/telecom/routing-profiles/:id` (present `rules` replaces the set) | `routing.manage` |
| `DELETE /v1/telecom/routing-profiles/:id` (soft delete) | `routing.manage` |

Rule fields: `destinationType`, `destination` (validated per type; webhooks
SSRF-checked, never called), `priority` (deterministic order), `enabled`,
`timeoutSeconds`, `retryCount`, `carrierId`, `failoverDestination`,
`failoverAfterSeconds`, `schedule {timezone, daysOfWeek[], startMinute,
endMinute}`. Duplicate name per tenant → 409. RBAC reuses `routing.read`/
`routing.manage` (12B — not `routing_profile.*`).

As of **Phase 12O-2ah** the full routing-profile surface — list, get, **create,
update, delete** — is authored into the OpenAPI contract (`CreateRoutingProfile` /
`UpdateRoutingProfile` + `RoutingRuleInput` / `RoutingScheduleInput` schemas in
`telvyn.v1.yaml`, so the contract fully describes the `rules[]` body too) and the
frontend Routing management screen consumes the generated types. The
POST/PATCH/DELETE handlers are unchanged since Phase 12H/12I — no backend change.
All three mutations gate on `routing.manage`. **This slice's UI covers the profile
envelope + the selection/failover policy only; it deliberately does NOT send
`rules`** — so create starts a profile with an empty rule set and edit omits `rules`
(the backend replaces the set only when `rules` is present, otherwise preserves it).
Edit (profile form) sends `expectedVersion` for optimistic concurrency (mismatch →
409), and the "failover enabled ⇒ ≥1 condition" rule is mirrored client-side and
authoritative server-side.

**Phase 12O-2ai** shipped the dedicated rules editor (frontend only — no contract
change; it consumes the `RoutingRuleInput` schema already authored above). It loads a
profile's full rule set, edits the core per-rule fields (destination type + value,
priority/order, enabled, weight, timeout, retries), and PATCHes the **complete**
`rules` array (replace semantics) with `expectedVersion`. **Phase 12O-2ap** made the
typed **failover** (destination + type, with optional after-seconds) and the time-of-day
**schedule** (timezone, days, start/end — entered as `HH:MM` and converted to
minutes-of-day with integer math) editable in the same editor; the schedule is
all-or-nothing and the failover destination+type go together (the server still rejects
a rule failing over to its own destination and validates the IANA timezone). The only
field still not editable in the UI is the per-rule `carrierId` tag (no per-rule carrier
picker yet) — it is preserved verbatim on existing rules so a replace never drops it (a
chip marks a rule that carries one); it remains fully settable via the API.

OpenAPI YAML still `/v1/auth` only (tracked debt) for the surfaces not yet closed.

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
No new permission created (routing.manage reused).

As of **Phase 12O-2aj** the full LCR-policy surface — list, get, **create, update,
delete** — is authored into the OpenAPI contract (`CreateLcrPolicy` /
`UpdateLcrPolicy` + `LcrRouteInput` schemas in `telvyn.v1.yaml`, so the contract
fully describes the `routes[]` body too, with `costMicros` typed as a non-negative
integer) and the frontend LCR management screen consumes the generated types. The
POST/PATCH/DELETE handlers are unchanged since Phase 12J — no backend change. All
three mutations gate on `routing.manage`. **This slice's UI covers the policy
envelope only (name, description, selection strategy, enabled); it deliberately does
NOT send `routes`** — so create starts a policy with an empty route set and edit omits
`routes` (the backend replaces the set only when `routes` is present, otherwise
preserves it). Edit (policy form) sends `expectedVersion` for optimistic concurrency
(mismatch → 409).

**Phase 12O-2ak** shipped the dedicated routes editor (frontend only — no contract
change; it consumes the `LcrRouteInput` schema already authored above). It loads a
policy's full route set, edits the core per-route fields, and PATCHes the **complete**
`routes` array (replace semantics) with `expectedVersion`. **Cost is entered as a
decimal per-minute amount (e.g. 0.012) and converted to the integer `costMicros` with
exact string math — ≤6 decimal places, no floating point (Phase 12O-2ar); a live hint
shows the resulting micro count, and an existing route's micros are shown back as the
decimal.**
Each route needs a carrier (chosen from the tenant's carriers via a picker — the LCR
API returns ids only, so an unknown current id shows by id until the list loads), a
prefix, a cost and a currency; priority, weight, country and enabled are optional.
**Phase 12O-2aq** made the remaining per-route options editable in the same editor: an
optional SIP trunk (its own picker, seeded like the carrier one) and the
`effectiveFrom`/`effectiveTo` window (entered with datetime-local inputs in the viewer's
timezone and converted to ISO instants on save; when both are set, from must precede
to). Every route now carries all of its own fields — there is nothing left preserved-
but-read-only. The server still validates carrier accessibility + trunk ownership and
the from/to ordering.

OpenAPI YAML still `/v1/auth` only (tracked debt) for the surfaces not yet closed.

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

`GET /v1/members` — the members of the session's **own** tenant, powering the
Admin → Members screen (Phase 12O-2ad). Strictly tenant-scoped: the tenant id
comes from the server-derived context, never the client, and the scoped Prisma
client never returns a foreign tenant's members (IDOR-safe; an e2e proves a
cross-tenant membership id never appears). Returns a JSON **array** (a team is
small — no pagination), ordered by join time (createdAt ASC).

| Method & path | Auth |
|---|---|
| `GET /v1/members` | `member.read` |
| `PUT /v1/members/:id/roles` (set a member's roles) | `member.manage` |
| `GET /v1/roles` (assignable roles) | `role.read` |

Response: `Member[]`, each `{ membershipId, status (ACTIVE\|SUSPENDED), user{id, email, fullName, status (ACTIVE\|INVITED\|DISABLED)}, roles[{id,key,name}] }`.
No secrets appear. `401` unauthenticated; `403` without `member.read`. This endpoint
already existed in `authz.controller.ts`; 12O-2ad authored it into the contract
(`Member` in `telvyn.v1.yaml`) and built the read screen — no backend change.

As of **Phase 12O-2al** the member **write** surface is authored into the contract
and built in the UI (frontend only — no backend change; the endpoints existed in
`authz.controller.ts`). `PUT /v1/members/{id}/roles` (`member.manage`) replaces a
membership's role set from `SetMemberRoles` `{ roleIds: uuid[] }` (replace semantics;
empty removes all; the server validates every id is a role valid for the tenant —
system or the tenant's custom — else 409; a foreign membership is 404) and returns
the full updated `Member[]`. `GET /v1/roles` (`role.read`) returns the assignable
`Role[]` (`{id,key,name,description,isSystem,permissions[]}`, system-first) to
populate the role picker. **Role assignment is the ONLY member mutation the API
exposes — there is no invite, suspend/activate, or remove endpoint**, so the UI
offers none. The aliased client type is `TenantRole` (the existing `Role` alias is
the session's own role shape from `MeContext`).
