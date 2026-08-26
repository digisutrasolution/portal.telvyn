# API.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**No API, no OpenAPI spec, no endpoints exist.**

## Principles — PLANNED (locked by constitution)

- Contract-first: OpenAPI 3 authored & reviewed before implementation;
  clients/types generated, never hand-written
- Versioned base path `/v1/...`; JSON; RFC 7807 `application/problem+json` errors
- Boundary validation of ALL input; deny-by-default permission check per route
- `Idempotency-Key` honored on all money/provisioning mutations
- Cursor pagination for list endpoints
- Rate limiting on auth + public surfaces

## Resource map — PROPOSED (draft; ratify with the domain ADRs)

| Resource | Operations |
|---|---|
| /v1/auth | login, refresh, logout, MFA enroll/verify |
| /v1/users, /v1/roles | identity & RBAC admin |
| /v1/dids | search inventory, order, assign, release |
| /v1/dids/{id}/routing | get/set delivery configuration |
| /v1/porting | port-in/out requests & status |
| /v1/carriers | upstream provider management (admin) |
| /v1/cdrs | CDR listing (filtered, paginated) |
| /v1/wallet or /v1/invoices | billing surface — **depends on UNKNOWN billing model** |
| /v1/audit-logs | audit trail (admin) |

## UNKNOWN

- API framework & runtime (ADR-0002)
- Webhook surface (carrier callbacks, customer notifications)
- Public-API exposure for customers (portal-only vs API keys)
