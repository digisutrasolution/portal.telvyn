# ADR-0006 — Control plane vs telecom data plane

- **Status:** Accepted
- **Date:** 2026-08-29
- **Deciders:** Architect / Telecom (Phase 12A)
- **Related:** CLAUDE.md (telecom rules), TELECOM.md, ADR-0007..0010

## Context

Phase 12 lays the telecom foundation. The single most important structural
decision is where telecom *configuration/orchestration* ends and telecom
*execution* (SIP signalling, RTP/media, call processing) begins. Getting this
boundary wrong couples business logic to a specific engine and pulls real-time
media concerns into the web/business tier — both forbidden by the constitution.

## Decision

Telvyn is split into two planes with a hard boundary.

**Control plane (this codebase — NestJS API + Postgres + web):**
business logic, tenants, users, RBAC, and all telecom **configuration** —
engines, nodes, regions, carriers, SIP trunks, DIDs, routing profiles,
credentials (references), health *state*, config versioning, audit, analytics,
administration. The control plane **stores and orchestrates**; it issues
configuration and reads status through adapters. It **never** terminates SIP,
never handles RTP, never runs a dialplan.

**Data plane (external telecom infrastructure — NOT this codebase):**
Kamailio / FreeSWITCH / Asterisk (or future engines) execute SIP registration,
call routing, and media. They are directly reachable on public IPs (never
behind an HTTP-only proxy/Cloudflare — CLAUDE.md), hold no business logic, and
run no static XML dialplans as the source of truth.

**Runtime-only concepts stay in the data plane.** `Registration` and
`CallSession` are live, ephemeral engine state. Phase 12 does **not** persist
them as control-plane business tables; they are surfaced read-only via the
health/status boundary (a live adapter query), honestly reported as `UNKNOWN`
when no engine is connected.

Request path: `Controller → TelecomService → TelecomEngineAdapter → provider
API / config interface → data plane`.

## Consequences

- The web app and NestJS never become a softphone/SBC. Media scaling concerns
  never enter the business tier.
- Config (durable) and runtime metrics (ephemeral) are separated by design
  (ADR-0010).
- The deployment topology (edge → SIP edge → media → carrier) is **documented
  as configurable**, not assumed or hard-wired (ADR-0007).
- Any future "just run Asterisk inside the API" shortcut is a violation of this
  ADR and must be rejected.
