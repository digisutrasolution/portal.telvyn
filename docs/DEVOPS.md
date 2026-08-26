# DEVOPS.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**Nothing provisioned.** No git repo initialized, no CI, no Dockerfiles, no
hosting, no DNS/TLS configured for portal.telvyn.co.

## Principles — PLANNED (locked by constitution)

- Everything containerized; environment parity
- CI on every push: lint → typecheck → tests → build; no red-main merges
- Migrations run as an explicit, logged deploy step — never auto on boot in prod
- Zero secrets in the repo; `.env.example` documents every variable
- Ops commands documented with REAL paths/hosts — copy-paste runnable

## Environments — PROPOSED

| Env | Purpose | Host |
|---|---|---|
| local | development, one-command bootstrap via docker compose | dev machine |
| staging | pre-prod verification | UNKNOWN |
| production | portal.telvyn.co | UNKNOWN |

## UNKNOWN

- Hosting target (VPS/cloud/k8s) and deploy pattern
- DNS/TLS/CDN posture (note: only the HTTP control plane may sit behind a
  CDN/proxy — any future SIP/RTP must not; see TELECOM.md)
- CI provider (follows git hosting choice)

## To fill in as they land

Repo scaffold · Dockerfiles/compose · CI definition · deploy runbook (RUNBOOK.md)
