# RUNBOOK.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**Empty by necessity** — no system is running. Every entry below is PLANNED and
gets written *with* the feature/infrastructure it operates, containing
copy-paste-runnable commands with real paths and hosts (never placeholders).

## Procedure index — PLANNED

1. Deploy / rollback
2. Run & verify a DB migration
3. Restore database from backup (drill-tested)
4. Rotate a compromised secret/credential
5. Suspend a customer / freeze billing
6. Investigate a stuck DID order or port request
7. CDR ingest backlog recovery
8. Fraud event lock-down
9. Incident response & post-mortem template

## On-call quick facts

| Item | Value | Status |
|---|---|---|
| Production URL | https://portal.telvyn.co | not live |
| Hosting | — | UNKNOWN |
| Escalation | — | UNKNOWN |
