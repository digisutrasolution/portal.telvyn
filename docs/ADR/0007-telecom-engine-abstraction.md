# ADR-0007 — Provider-neutral telecom engine abstraction

- **Status:** Accepted
- **Date:** 2026-08-29
- **Deciders:** Architect / Telecom (Phase 12A)
- **Related:** ADR-0006, ADR-0010

## Context

The control plane must orchestrate multiple, swappable telecom engines
(Kamailio, Asterisk, FreeSWITCH, and future engines). The constitution forbids
permanent coupling to any one engine. Engines differ in capabilities — not
every engine does WebRTC, recording, or SRTP — so capability must be
*discovered*, never assumed.

## Decision

- **`TelecomEngineAdapter` interface** is the single integration boundary
  between `TelecomService` and any engine. Initial contract (grows later):
  `describeCapabilities()`, `healthCheck()`, and (future) `applyConfig()` /
  `reload()`. No service talks to an engine except through an adapter.
- **`EngineRegistryService`** maps a persisted `TelecomEngine` row to its
  adapter instance by `type`.
- **Adapters begin as honest stubs.** `KamailioAdapter`, `AsteriskAdapter`,
  `FreeSWITCHAdapter` are created but marked **NOT IMPLEMENTED**:
  `healthCheck()` returns `UNKNOWN`; mutating methods throw
  `NotImplementedException`. **No fake data, no fabricated success, no static
  XML.** An engine that is not really connected reports that honestly.
- **Capabilities are explicit rows** (`EngineCapability`), not inferred from
  the engine `type`. Capability set: SIP, RTP, WEBRTC, REGISTRATION,
  INBOUND_CALLS, OUTBOUND_CALLS, IVR, RECORDING, TRANSCRIPTION, TTS, SRTP, TLS,
  CALL_TRANSFER, CALL_FORWARDING, CODEC_* (as needed). Consumers must check
  capability before using a feature.
- **Topology is configurable.** The edge → SIP edge → media → carrier chain is
  documented as one possible deployment, not a mandatory sequence baked into
  the model.

## Consequences

- Adding an engine = a new adapter + registry entry; no business-logic change.
- Feature code degrades gracefully when a capability is absent.
- Until an adapter is genuinely implemented (a later phase, once the
  integration contract with real infra is defined), the system is honest about
  having no live engine — health reads `UNKNOWN`, provisioning is refused, and
  nothing pretends otherwise.

## Addendum — Phase 12K (2026-09-01): engine foundation

The growth path this ADR anticipated (`applyConfig()` / `reload()`) is now
realized as a provider-neutral *foundation* — still control-plane only, still no
SIP/RTP/engine runtime.

- **Provider-neutral types** (`engine.types.ts`): `EngineCapabilities` (a boolean
  operation profile — `health`, `routing`, `registration`, `activeCalls`,
  `originate`, `configuration` — distinct from the persisted `EngineCapability`
  *feature* rows), `EngineHealthResult`, `EngineContext` (correlation id +
  bounded timeout), `EngineStatus`, a normalized `EngineErrorCode` /
  `EngineError`, `EngineOperationResult`, and a **secret-free**
  `EngineConfigurationIntent` (credentials appear only as a `credentialRef` id,
  never a secret).
- **Adapter contract grew** by `capabilities(): EngineCapabilities` and
  `applyConfiguration(intent, ctx): Promise<EngineOperationResult>`. Capability
  differences are explicit and honest: Kamailio (SIP signalling/router) reports
  `originate:false`; Asterisk and FreeSWITCH (B2BUA / softswitch) report
  `originate:true`. All adapters remain honest stubs — `applyConfiguration()`
  throws `EngineError(NOT_IMPLEMENTED)`; `healthCheck()` stays `UNKNOWN`.
- **`EngineService`** is the orchestration layer: resolves adapters via the
  registry (never dynamic class instantiation, never tenant-controlled type
  names — unsupported types are rejected by the registry), wraps every adapter
  call in a bounded-timeout guard (default 5 s, hard cap 30 s — never infinite),
  stamps a correlation id, emits structured **secret-free** log lines, and
  normalizes all errors (unknown-error detail is suppressed — no engine internals
  leak). `buildConfigurationIntent()` is a pure translator with no I/O.
- **Platform-only endpoints** (reuse `telecom.health.read` / `telecom.manage`,
  behind `PlatformGuard`): `GET :id/status` returns explicit capabilities + honest
  UNKNOWN health + correlation id; `POST :id/sync` attempts synchronization and,
  with stub adapters, returns a normalized `NOT_IMPLEMENTED` → **HTTP 501** (no
  fake success), auditing `telecom.engine.sync_attempted` every time.
- **No new persistence, no migration.** The engine / node / health model
  (ADR-0010) and the credential vault (ADR-0009) are reused unchanged.

The next phase (real adapter implementation) plugs engine connectivity into these
seams without changing the control-plane contract or business logic.
