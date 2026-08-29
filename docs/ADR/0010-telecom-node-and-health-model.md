# ADR-0010 — Telecom node: configuration vs runtime, and the health model

- **Status:** Accepted
- **Date:** 2026-08-29
- **Deciders:** Architect / Telecom (Phase 12A)
- **Related:** ADR-0006, ADR-0007, MONITORING.md

## Context

A telecom node (a Kamailio/FreeSWITCH/Asterisk instance) has both durable
**configuration** (identity, engine, region, capacity limits) and volatile
**runtime state** (current health, latency, active calls, last heartbeat).
Persisting high-frequency runtime metrics as business rows would bloat the
OLTP store and blur the config/runtime line. The health framework must never
fabricate data.

## Decision

**Separate configuration from runtime.**

- **Config (durable, Postgres):** `TelecomNode` — identity, `engineId`,
  `regionId`, zone, environment, `hostRef` (address reference, **not** a
  secret), status (administrative: ACTIVE/DISABLED), version, and **capacity
  limits** `maxCps` / `maxConcurrentCalls` (configured ceilings, not live
  values).
- **Runtime (ephemeral):** the **latest** health snapshot per node lives in a
  small mutable `NodeHealth` row (1:1) — status, latency, `lastHeartbeatAt` —
  and/or Redis. High-frequency per-tick metrics are **not** persisted as
  history in Postgres.
- **Health events (append-only):** meaningful **status transitions** (not every
  sample) are appended to `HealthEvent` (entity, from → to, reason,
  correlationId, timestamp) for forensics and timelines.

**Health model (provider-neutral).** Checks cover API connectivity, SIP
connectivity (where applicable), node availability, carrier availability,
registration health, latency, and last heartbeat. Statuses:
`HEALTHY | DEGRADED | UNHEALTHY | UNKNOWN | DISABLED`.

**No fabricated health.** Health is derived from a real adapter `healthCheck()`
(ADR-0007). With no engine connected / adapter not implemented, status is
`UNKNOWN`; an administratively disabled node/carrier is `DISABLED`. The system
never reports `HEALTHY` for something it has not actually probed.

## Consequences

- The OLTP store holds configuration + status transitions, not a metrics
  firehose; live metrics belong to the runtime store (Redis/ephemeral) and, in
  later phases, the observability stack (MONITORING.md).
- Capacity ceilings (config) and current utilization (runtime) are never
  conflated.
- Dashboards (12K/future NOC) render honest states, including empty/`UNKNOWN`,
  never invented numbers.
