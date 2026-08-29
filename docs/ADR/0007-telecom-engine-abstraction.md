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
