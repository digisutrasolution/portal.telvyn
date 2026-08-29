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

---

## Telecom platform infrastructure — EXISTING (Phase 12D, 2026-08-29)

Platform-only telecom infra. Guard stack on every route:
`JwtAuthGuard → TenantGuard → PlatformGuard → PermissionGuard`. `PlatformGuard`
requires the caller's active tenant to be `PLATFORM` — a customer/reseller
tenant is refused (403) even if its role holds `*`. Mutations are audited via
the existing `AuditService`. None of these resources hold secrets.

| Method & path | Permission |
|---|---|
| `GET /v1/telecom/regions` · `GET /v1/telecom/regions/:id` | `telecom.read` |
| `POST/PUT/DELETE /v1/telecom/regions[/:id]` | `telecom.manage` |
| `GET /v1/telecom/engines` · `GET /v1/telecom/engines/:id` | `telecom.read` |
| `POST/PUT/DELETE /v1/telecom/engines[/:id]` · `PUT /v1/telecom/engines/:id/capabilities` | `telecom.manage` |
| `GET /v1/telecom/nodes` · `GET /v1/telecom/nodes/:id` | `telecom.read` |
| `GET /v1/telecom/nodes/:id/health` | `telecom.health.read` |
| `POST/PUT/DELETE /v1/telecom/nodes[/:id]` | `telecom.manage` |

Engine GET is enriched with honest adapter metadata (ADR-0007): `implemented`
(false until a real integration), `softwareCapabilities` (the engine's declared
profile), `capabilities` (admin-enabled per instance), and live `health`
(UNKNOWN via the stub). Node `health` starts UNKNOWN (populated by the health
framework, 12I). Lists are bounded (take 500); cursor pagination lands with the
high-cardinality tenant resources (DIDs, 12G). **Note:** the hand-authored
OpenAPI YAML currently covers `/v1/auth` only; authz + telecom endpoints are
documented here (pre-existing gap, tracked — YAML expansion is future work).
