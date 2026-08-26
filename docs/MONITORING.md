# MONITORING.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**Nothing instrumented** (no code exists).

## Signal inventory — PLANNED (to implement with the features that emit them)

- API availability & latency (p50/p95/p99) per route; error rates
- Structured logs with correlation IDs end-to-end
- DB health: connections, slow queries, backup status
- Queue/worker depth, job failure rates
- Business: failing DID orders, stuck provisioning/ports, payment failures,
  fraud-limit trips, reconciliation mismatches (ledger vs cached balances)
- Telecom (if in scope): ASR/ACD, carrier API failures, CDR ingest lag

## Alerting policy — PLANNED

Every alert is actionable and maps to a RUNBOOK.md entry. No pager noise.

## UNKNOWN

- Observability stack (self-hosted Prometheus/Grafana/Loki vs hosted) —
  follows the hosting decision
- SLO targets — follow from UNKNOWN scale expectations
