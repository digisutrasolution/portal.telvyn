# TELECOM.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**No telecom integration exists.** No carrier is contracted or selected; no
engine is connected. **Phase 12A (2026-08-29)** established the telecom
**control-plane architecture and domain boundaries** below (documentation +
ADRs 0006–0010); no schema or code exists yet — that begins in Phase 12B.

---

# Telecom control plane — architecture & domain boundaries (Phase 12A)

## Control plane vs data plane (ADR-0006)

Telvyn's NestJS backend is the **control plane**: it stores telecom
*configuration* and *orchestrates* engines through adapters. It never
terminates SIP, never handles RTP, never runs a dialplan. Kamailio /
FreeSWITCH / Asterisk (or future engines) are the **data plane** — external
infrastructure that executes SIP/media, reachable directly on public IPs
(never behind an HTTP-only proxy), holding no business logic.

```
Controller → TelecomService → TelecomEngineAdapter → provider API/config → DATA PLANE
```

`Registration` and `CallSession` are **data-plane runtime** concepts — **not
persisted** as control-plane tables in Phase 12; surfaced read-only via the
health/status boundary, honestly `UNKNOWN` when no engine is connected.

## Domain boundaries (the 15 concepts) — table vs deferred

Owner-approved granularity (no speculative tables; promote deferred concepts to
tables only when real requirements justify them).

| # | Concept | Phase-12 form | Scope |
|---|---|---|---|
| 1 | **Telecom Engine** | table `TelecomEngine` + `EngineCapability` rows | platform |
| 2 | **Carrier** | table `Carrier` + `CarrierSipEndpoint` (child) | platform *or* tenant (ADR-0008) |
| 3 | **SIP Trunk** | table `SipTrunk` | tenant |
| 4 | **DID** | table `Did` | tenant |
| 5 | **Endpoint** | **deferred** — modeled as trunk/registration fields for now | — |
| 6 | **Routing Profile** | table `RoutingProfile` (+ light child `RoutingRule`) | tenant |
| 7 | **Route** | `RoutingRule` rows under a profile (no engine yet) | tenant |
| 8 | **Failover Policy** | **deferred** — fields on `RoutingRule` | — |
| 9 | **Codec Policy** | **deferred** — `codecs[]` enum array on carrier/trunk | — |
| 10 | **Numbering Plan** | **deferred** — `country`/`e164` on `Did` for now | — |
| 11 | **Region** | table `Region` | platform |
| 12 | **Telecom Node** | table `TelecomNode` (config) + `NodeHealth` (runtime) | platform |
| 13 | **Health Check** | `NodeHealth` snapshot + `HealthEvent` (transitions) | platform/tenant |
| 14 | **Registration** | **runtime, not persisted** (data plane) | — |
| 15 | **Call Session** | **runtime, not persisted** (data plane) | — |

Supporting tables: **`TelecomCredential`** (secret vault, ADR-0009),
**`TelecomConfigVersion`** (append-only config-change ledger, secret-free).

## Telecom engine abstraction (ADR-0007)

Provider-neutral. `TelecomEngineAdapter` is the sole integration boundary;
`EngineRegistryService` maps an engine row → its adapter. `KamailioAdapter` /
`AsteriskAdapter` / `FreeSWITCHAdapter` start as **honest `NOT IMPLEMENTED`
stubs** (`healthCheck()` → `UNKNOWN`, mutations throw) — no fake data, no static
XML. **Capabilities are explicit** (`EngineCapability`), never inferred from
engine type: SIP, RTP, WEBRTC, REGISTRATION, INBOUND_CALLS, OUTBOUND_CALLS,
IVR, RECORDING, TRANSCRIPTION, TTS, SRTP, TLS, CALL_TRANSFER, CALL_FORWARDING,
codecs. Deployment topology (edge → SIP edge → media → carrier) is documented
as **configurable**, not a mandatory chain.

### Engine foundation (Phase 12K, 2026-09-01)

The abstraction gained a provider-neutral *operation* layer — still control-plane
only, no SIP/RTP/engine runtime. `engine.types.ts` defines an `EngineCapabilities`
operation profile (`health`, `routing`, `registration`, `activeCalls`,
`originate`, `configuration` — distinct from the `EngineCapability` *feature*
rows above), a normalized `EngineErrorCode`/`EngineError`, an `EngineContext`
(correlation id + bounded timeout), and a **secret-free** `EngineConfigurationIntent`
(credentials reduced to a `credentialRef` id). Adapters now declare
`capabilities()` — honest per engine class: **Kamailio `originate:false`**
(SIP router/signalling), **Asterisk / FreeSWITCH `originate:true`** (B2BUA /
softswitch) — and `applyConfiguration()`, which throws `NOT_IMPLEMENTED` while
stubbed.

`EngineService` orchestrates adapters: registry-resolved only (unsupported types
rejected; never dynamic class instantiation or tenant-controlled type names),
every call wrapped in a **bounded timeout** (default 5 s, hard cap 30 s — never
infinite), correlation-id stamped, structured **secret-free** logging, and
uniform error normalization (unknown-error detail suppressed). Two platform-only
endpoints expose it (see API.md): `GET /v1/telecom/engines/:id/status` (explicit
capabilities + honest `UNKNOWN` health) and `POST /v1/telecom/engines/:id/sync`
(→ **HTTP 501 NOT_IMPLEMENTED**, audited `telecom.engine.sync_attempted`; no fake
success). Real engine connectivity plugs into these seams in a later phase without
changing the contract.

## Node config vs runtime + health (ADR-0010)

Config (durable): identity, engine, region, zone, environment, `hostRef`,
capacity ceilings (`maxCps`, `maxConcurrentCalls`). Runtime (ephemeral): latest
`NodeHealth` snapshot (status, latency, `lastHeartbeatAt`) — Postgres holds
transitions (`HealthEvent`), not a per-tick metrics firehose. Health statuses:
`HEALTHY | DEGRADED | UNHEALTHY | UNKNOWN | DISABLED`. **Never fabricated** —
`UNKNOWN` until a real adapter probe exists.

## Credentials (ADR-0009)

SIP/carrier secrets live **only** in the `TelecomCredential` vault
(AES-256-GCM at rest via the existing `encryptSecret`). Carrier/trunk rows hold
a `credentialId` reference + a non-secret hint — **never** a plaintext secret.
Decryption happens only inside the adapter boundary; secrets never appear in
API responses, DTOs, logs, audit metadata, or config-version snapshots.
Architecture is external-secret-manager compatible.

## Region architecture

`Region` (code, country, timezone, providerRegion, `failoverRegionId` self-FK)
prepares multi-region infrastructure. Global traffic routing is **not** built
in Phase 12 — only the abstractions it will need.

## Security model (Phase 12)

Tenant-owned telecom models (`SipTrunk`, `Did`, `RoutingProfile`, `RoutingRule`,
tenant `Carrier`) join the data-layer tenant scope (ADR-0004); dual-nature
`Carrier`/credentials use a tested **system-or-tenant** read mode (ADR-0008).
Platform infra (`Region`, `TelecomEngine`, `TelecomNode`, wholesale carriers)
is mutable only by `PLATFORM`-tenant members with platform permissions. Every
mutation is RBAC-gated and audited through the existing `AuditService`. New
permission keys follow the existing convention: `telecom.read`,
`telecom.health.read`, `carrier.{read,create,update,delete}`,
`sip_trunk.{read,create,update,delete}`, `did.{read,manage}`,
`routing.{read,manage}`.

---

## Legacy planning notes (pre-Phase-12)

## DID lifecycle — PLANNED (canonical state machine, per constitution)

```
AVAILABLE → RESERVED → ASSIGNED → (PORTING_OUT) → RELEASED
     ↑                      |
     └──────────────────────┘ (unassign/recycle)
PORTING_IN → ASSIGNED
```

Every transition audited and permission-gated.

## Hard constraints — PLANNED (non-negotiable, per constitution)

- Toll-fraud guards (rate/velocity/geo/spend limits, balance checks) are
  day-one requirements on any call-affecting feature.
- If Telvyn ever operates SIP/RTP: directly reachable public-IP hosts only —
  never behind Cloudflare/HTTP proxies; no business logic or static dialplans
  in media servers.

## UNKNOWN (all need owner decisions/contracts)

1. DID supply: which upstream carrier(s)/provider(s); API-automated vs manual ordering
2. Delivery model: SIP trunk / PSTN forward / registration — determines whether
   Telvyn runs any signalling-media plane at launch or is pure control plane
3. Launch market(s) → regulatory surface: STIR/SHAKEN, emergency services,
   porting/LOA obligations, KYC for numbers, robocall mitigation
4. CDR source: carrier files/webhooks vs own switch records
5. SMS scope: in or out of the product

## Integrations

None — documented per carrier as each is contracted.

## Carrier foundation — EXISTING (Phase 12E, 2026-08-29)

Carriers are **dual-nature** (ADR-0008): `tenantId = null` → **SYSTEM**
(platform/wholesale, operator-owned); `tenantId` set → **TENANT**-owned. Scope
is derived from the authenticated context via the `systemOrTenantWhere` /
`authorizeDualNatureWrite` / `ownerTenantIdForCreate` helpers — never from a
client field. A caller reads its own carriers + system carriers; may write only
its own (a tenant writing a system carrier → 403; another tenant's id → 404,
IDOR-safe); a PLATFORM caller creates/manages system carriers. Scope is
**immutable** (no tenant→system escalation — the DTO has no tenantId/scope field).

**Credential vault relationship (ADR-0009):** carriers reference a
`TelecomCredential` by id; secrets live only in the vault (AES-256-GCM). Carrier
APIs expose safe metadata only (`credentialId`, type, label, non-secret hint,
scope) — never the secret, in responses, lists, logs, or audit. Decryption is
confined to `TelecomCredentialService.revealForAdapter` (adapter boundary; no
API path reaches it; secrets are not cached). Credential attachment is
ownership-checked: own = allowed, system = platform-only, foreign tenant = 404.

**Status vs health:** administrative `status` (ACTIVE/SUSPENDED/DISABLED) is a
config field; **health is separate and honest** — reported `UNKNOWN` (no carrier
health check exists yet). **Delete is soft** (`deletedAt`) — history preserved,
no cascade destruction. LCR / rate cards / routing remain out of scope.

## SIP trunk foundation — EXISTING (Phase 12F, 2026-08-29)

**Control-plane configuration only — NO live SIP/RTP connectivity.** SIP trunks
are **strictly tenant-owned** (required `tenantId`) and use the auto-scoping
client (`prisma.scoped.sipTrunk`) for deny-by-default tenant isolation + IDOR
(foreign id → 404). Additive migration `sip_trunk_carrier_link` added the
required `carrierId` FK (the trunk↔carrier link 12B lacked).

- **Carrier relationship:** every trunk references a carrier that must be
  accessible in the caller's scope (own or system, via `systemOrTenantWhere`);
  a foreign/deleted/nonexistent carrier → 400.
- **Credential (ADR-0009):** SIP passwords live in the vault; the trunk holds a
  `credentialId`. Referenced credentials are type-checked (must be
  `SIP_PASSWORD`) and ownership-checked (foreign → 404, system → 403); inline
  credentials are vaulted as SIP_PASSWORD. Secrets never appear in
  responses/lists/audit/logs (credential `select` omits `secretEnc`).
- **Auth modes:** `IP` and `CREDENTIALS` (12B enum) — `NONE`/`REGISTRATION` are
  future (runtime registration remains non-persisted, Phase 12A). Transport
  (`UDP/TCP/TLS`), TLS, SRTP, DTMF, codecs are declarative config; **no cert
  provisioning, no media/RTP, no live registration**.
- **Endpoint (SSRF posture):** host/URI validated as attacker-controlled — no
  control chars, no CRLF/header injection, valid host/IP, `sip:`/`sips:` scheme
  only. **No outbound connection is ever made in 12F.** A future health/probe
  service MUST add allowlisting, egress/private-network restrictions, DNS-
  rebinding protection, IP validation, timeouts, and auditability before
  contacting any user-supplied endpoint (documented boundary).
- **Status vs health:** administrative `status` is config; health is honest
  `UNKNOWN`. **Soft delete** (`deletedAt`); no cascade destruction.

## DID foundation — EXISTING (Phase 12G, 2026-08-29)

**Control-plane resource only — NO telecom runtime.** DIDs are **strictly
tenant-owned** via the auto-scoping client (deny-by-default + IDOR). The
nullable-`tenantId` platform inventory pool is **not exposed** by the 12G API
(reserved for a future inventory/acquisition phase — no system DIDs invented).
Additive migration `did_sip_trunk_link` added `Did.sipTrunkId` (FK, SetNull) +
filter indexes.

- **E.164 normalization** via `libphonenumber-js` (vetted): raw input is parsed
  to canonical E.164; **country is derived from the number**, never trusted from
  the client. Format validity ≠ carrier validity.
- **Uniqueness: GLOBAL** — `Did.e164 @unique` (DB-enforced across all tenants;
  a physical number cannot exist as two DIDs). **Analysis/decision:** kept the
  plain global unique from 12B (includes soft-deleted rows), so a released
  number is not yet recyclable; moving to a **partial unique**
  (`WHERE deleted_at IS NULL`) is deferred to when the release-and-reacquire
  workflow is built (table currently has no data conflict). Duplicate → 409.
- **Relationships (all validated server-side):** carrier accessible in scope
  (own/system); SIP trunk owned by the same tenant; routing profile owned by the
  same tenant; region exists — foreign/deleted → 400. **Carrier↔trunk
  consistency:** if both set, the trunk must belong to the referenced carrier.
- **Status vs health:** administrative `DidStatus` (AVAILABLE/ASSIGNED/ACTIVE/
  SUSPENDED/PORTING/RELEASED/…) is config; health is honest `UNKNOWN`.
- **Delete is soft;** relationships use `SET NULL` (a DID losing a relation is
  not deleted, and deleting a DID never cascades to carrier/trunk/profile/region).
  Responses carry **reference ids only** — no embedded related objects.

## Routing profile foundation — EXISTING (Phase 12H, 2026-08-29)

**Declarative configuration only — NOTHING is executed** (no SIP/webhook/failover/
LCR runtime). Reuses the 12B `RoutingProfile` + `RoutingRule` tables; additive
migration `routing_rule_config` typed the destination and added retry/timeout/
schedule. Profiles are **strictly tenant-owned** (auto-scoped); `RoutingProfile`
joined `TENANT_SCOPED_MODELS`.

- **Ownership:** server-derived tenant; `@@unique([tenantId, name])` (duplicate → 409).
- **Destination model:** `RoutingDestinationType` = SIP_TRUNK | PHONE_NUMBER |
  EXTENSION | VOICEMAIL | WEBHOOK (AI/application deferred). Each type constrains
  the `destination` value: SIP_TRUNK → a tenant-owned trunk id (validated);
  PHONE_NUMBER → canonical E.164 (normalized on store); EXTENSION → digits;
  VOICEMAIL → simple identifier; **WEBHOOK → https URL to a public host** —
  SSRF-validated (https only, no credentials-in-URL, no private/loopback/
  link-local/multicast targets, no control chars). **Webhooks are never called
  in 12H.** Future webhook execution requires allowlisting, egress controls,
  private-IP blocking, DNS-rebinding protection, timeout + response-size limits,
  and auditability (documented boundary).
- **Rules** are managed embedded in the profile (a `rules` array; PATCH with
  `rules` replaces the set atomically). **Priority ordering is deterministic:
  priority ASC, then id ASC** (stable; duplicate priorities tie-break by id) —
  never insertion order.
- **Retry/timeout:** bounded config (retryCount 0–10, timeoutSeconds 1–600) —
  never executed. **Schedule:** optional `{ timezone, daysOfWeek[], startMinute,
  endMinute }`; timezone is validated as **IANA** via the platform `Intl` (no
  silent server-local assumption); start < end enforced.
- **Carrier reference** on a rule is validated accessible (own/system).
- **Status vs health:** administrative `TelecomStatus`; no runtime health.
- **Delete is soft;** deleting a profile does not cascade to carriers/trunks and
  does not auto-reassign DIDs referencing it. RBAC reuses `routing.read`/
  `routing.manage`; responses carry reference ids/config only (no secrets).

## Routing policy + failover — EXISTING (Phase 12I, 2026-08-29)

**Declarative policy only — NOTHING executed.** Extends the 12H profile (no new
FailoverPolicy table — policy is 1:1 with `RoutingProfile`, so policy is stored
as fields; additive migration `routing_policy_failover`).

- **Policy semantics:** `selectionStrategy` (PRIORITY | WEIGHTED | ROUND_ROBIN |
  SIMULTANEOUS) governs how rules are chosen (runtime = future engine adapter).
  `RoutingRule.weight` supports WEIGHTED (config only).
- **Declarative failover:** `failoverEnabled` + `failoverConditions[]`
  (NO_ANSWER | BUSY | FAILED | UNREACHABLE | TIMEOUT). `failoverEnabled` with no
  conditions is rejected (no silent no-op). Per-rule `failoverDestination` is now
  **typed** (`failoverDestinationType`) and validated exactly like the primary.
- **Ordering** stays deterministic (priority ASC, id ASC); strategy affects
  runtime selection only (not enumeration).
- **Retry/timeout** bounded (retryCount 0–10, timeoutSeconds 1–600,
  failoverAfterSeconds 1–600, overallTimeoutSeconds 1–3600) — never executed.
- **Loop protection (declarative):** a rule may not fail over to its own
  destination (rejected, incl. normalized-equal phone numbers); `maxAttempts`
  (1–20) caps total attempts; retries/rules are bounded. Runtime cycle detection
  across chains is a future engine concern (documented).
- **Atomicity + concurrency:** rule replacement is atomic (validation happens
  before the transaction — an invalid rule aborts the whole update, no partial
  write). `RoutingProfile.version` provides **optimistic concurrency**: PATCH may
  send `expectedVersion`; a mismatch → 409 (atomic `updateMany WHERE version=…`).
  Every update increments `version`. Without `expectedVersion`, last-writer-wins.
- Carrier/trunk consistency + tenant-safe relationship validation unchanged
  (own trunk, accessible carrier). No runtime network calls during CRUD.

## Future engine boundary

Control plane: `RoutingProfile → RoutingRule → policy fields`. A **future engine
adapter** (ADR-0007) will read this declarative config and program the data
plane (Kamailio/FreeSWITCH/Asterisk). Business routing logic stays out of the
SIP/media engines.

## LCR policy foundation — EXISTING (Phase 12J, 2026-08-29)

**Declarative route SELECTION only — NOTHING executed, no rating, no billing,
no wallet charging.** LCR is distinct from `RoutingProfile` (inbound delivery):
it picks an outbound carrier by cost/priority/prefix. New tables `LcrPolicy`
(tenant-owned, strategy + `version`) + `LcrRoute` (candidates); additive
migration `lcr_policy`. `LcrPolicy` joined `TENANT_SCOPED_MODELS`.

- **Route candidate model:** `LcrRoute` = `carrierId` (required, accessible) +
  optional `sipTrunkId` (owned) + `prefix` + `country?` + `costMicros` +
  `currency` + `priority` + `weight?` + `enabled` + `effectiveFrom?/To?`.
  Carrier/trunk are **references** (never duplicated; no credentials/secrets).
- **Cost / currency (12J-6/7):** `costMicros` is a **BigInt in millionths of a
  currency unit** — integer, no floating point; validated non-negative, bounded,
  no NaN/Infinity. This is a **route-selection cost, not a billed amount**
  (rating/billing remain separate + future). New shared `Currency` enum
  (USD/EUR/GBP/INR/AUD/CAD/JPY — not USD-only); **no FX conversion** in LCR
  (future dedicated concern).
- **Selection strategy:** `LcrSelectionStrategy` = LOWEST_COST | HIGHEST_PRIORITY
  | WEIGHTED | QUALITY_FIRST. **Deterministic ordering** (pure function
  `orderCandidates`): LOWEST_COST → cost, priority, id; HIGHEST_PRIORITY →
  priority, cost, id; WEIGHTED → weight desc, priority, id; QUALITY_FIRST →
  priority, cost, id (**no health subsystem yet — UNKNOWN; quality is a future
  engine input**, honest fallback). **Every tie breaks on `id`** — never
  insertion/DB order. GET returns candidates already in selection order.
- **Prefix matching (12J-8):** `prefix` is an E.164-style digit string (no
  NumberingPlan table — deferred, 12A). Documented runtime semantics
  (future engine): longest-prefix wins, exact-match preferred, then strategy
  tie-break. Not executed here.
- **Effective dates:** `effectiveFrom < effectiveTo` validated; future/inactive
  windows allowed. Overlap is NOT constrained (multiple candidates per prefix is
  the point of LCR).
- **Failover relationship:** LCR (candidate ordering) and failover (12I, when a
  candidate fails) are **separate**; the future engine decides failure. Not here.
- **Eligibility/atomicity/concurrency:** carrier accessible (own/system, ADR-0008),
  trunk owned; routes replaced atomically (validation before txn); `version`
  optimistic concurrency (`expectedVersion` → 409). RBAC reuses
  `routing.read`/`routing.manage` (LCR is the routing domain; no credential
  access). Soft delete; carrier hard-delete blocked by RESTRICT.

## Future routing-decision contract (12J-21)

`RoutingDecisionInput → PolicyEvaluator → CandidateRoutes → SelectedRoute →
FailoverCandidates → Future Engine Adapter (Kamailio/FreeSWITCH/Asterisk)`. The
control plane stays authoritative for pricing, carrier preference, customer
routing policy, tenant config, billing, and authorization — the SIP/media
engines never own these.
