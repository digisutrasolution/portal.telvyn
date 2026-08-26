# DISASTER_RECOVERY.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**No production system exists; there is nothing to recover yet.** This plan is
implemented alongside the first production deploy — not after.

## Objectives — PROPOSED (need owner sign-off)

| Metric | Proposed target |
|---|---|
| RPO (max data loss) | ≤ 15 min (WAL archiving / PITR) |
| RTO (max downtime) | ≤ 4 h |

## Plan — PLANNED in principle, detail PROPOSED

1. **Database**: automated daily full backups + continuous WAL archiving,
   encrypted, stored off-host; restore drills quarterly and after schema epochs
2. **Object storage** (if any): versioned buckets + lifecycle rules
3. **Secrets/config**: secret manager as source of truth; recovery path documented
4. **Infrastructure**: fully rebuildable from the repo (compose/IaC) + this doc
5. **Ledger integrity**: post-restore reconciliation job proves balances —
   billing data is the most restore-sensitive asset

## Failure scenarios to script in RUNBOOK.md — PLANNED

DB loss/corruption · host loss · bad-deploy rollback · carrier API outage ·
domain/TLS failure · compromised-credential rotation

## UNKNOWN

Backup storage location, tooling, and drill schedule — follow hosting decision.
