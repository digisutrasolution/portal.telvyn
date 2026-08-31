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
