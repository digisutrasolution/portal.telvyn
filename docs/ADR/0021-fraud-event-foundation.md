# ADR-0021 — Fraud-event foundation & authorization-infrastructure direction

- Status: **Accepted** (2026-11-23)
- Supersedes: none
- Related: SEC-002 (toll-fraud control design), ADR-0004 (tenant isolation),
  ADR-0006 (control plane vs data plane), ADR-0010 (audit model boundary),
  ADR-0020 (node/carrier liveness — append-only event precedent)

## Context

ROADMAP Phase 12 (Routing + **Toll-Fraud Rails**) is the first call-affecting
capability, and SEC-002 makes a concrete toll-fraud control spec a hard gate:
spend / velocity / geo limits, balance gates, a kill-switch, real-time alerts,
fail-closed behavior, and append-only audit of denials. That full capability is
large; the Phase-12R implementation plan breaks it into narrow slices.

This ADR covers **slice 12R-1 only**: the foundational, append-only
**fraud-event store** and the direction for the authorization infrastructure
that later slices build on. It deliberately implements **no enforcement** — no
call authorization, spend/velocity/geo/destination control, kill-switch, or
engine wiring. Those are later slices, each gated on its own decisions.

Telvyn already has the primitives this foundation needs, built and tested:
append-only event tables (`HealthEvent`, `SecurityEvent`), tenant-scoped data
isolation (ADR-0004, `TENANT_SCOPED_MODELS`), a tenant-scoped audit service
(`AuditService`), the permission catalog (deny-by-default), fail-closed Redis
primitives (`RateLimitService`, `EngineLockService`), and the integer-micros /
`Currency` money convention. The foundation reuses these; it introduces no new
framework.

## Decision

1. **Fraud-event architecture.** Introduce one additive, append-only
   `FraudEvent` model — the durable, tamper-evident record of fraud-relevant
   occurrences (limit warnings, authorization denials, kill-switch activations,
   policy changes, anomalies). It mirrors the existing append-only event
   pattern (`HealthEvent` / `SecurityEvent`): insert-only, timestamped, indexed
   for query.

2. **Tenant ownership & isolation.** `FraudEvent.tenantId` is **required** and
   the model is registered in `TENANT_SCOPED_MODELS`, so the tenant-scoping
   Prisma extension (ADR-0004) injects the server-derived tenantId on every
   read and create and refuses unscoped access (deny-by-default, IDOR-safe). A
   tenant can never read another tenant's fraud events. Platform-scoped events
   and cross-tenant (`read_all`) visibility are **out of scope** here and
   deferred to the slice that first produces platform-scoped events
   (kill-switch, 12R-3); relaxing `tenantId` to nullable later is an additive
   change.

3. **Permission boundaries.** One narrowly scoped permission,
   `fraud.events.read` (group `fraud`), grants tenant-scoped read of a tenant's
   own fraud events. It is granted to the `owner` (via `*`), `admin`, and
   `auditor` system roles only — mirroring `audit.read`; the `operator` role is
   intentionally excluded (least privilege). No role receives a `fraud.*`
   wildcard, so no future `fraud.manage` / kill-switch permission is granted by
   escalation. Platform-wide access is never conferred by a tenant permission;
   where a future platform read is justified it will be gated by `PlatformGuard`
   (tenant type), consistent with the telecom control plane.

4. **Audit integration.** Fraud events do **not** create a second audit
   framework. `FraudEvent` is the domain event store; the existing
   `AuditService` remains the record for administrative mutations. When a fraud
   event is raised by an authenticated actor's action, `FraudEventService.record`
   additionally writes one `AuditService` entry (actor + tenant + a safe
   reference), reusing the tenant-scoped audit path. System-raised events (the
   future call-authorization path, which has no human actor and can fire at call
   volume) write the `FraudEvent` only — never an `AuditLog` per event — to avoid
   the OLTP audit firehose that ADR-0010 warns against.

5. **Event lifecycle & integrity.** `FraudEvent` is **append-only and
   immutable**: no `updatedAt`, no `deletedAt`, no mutation endpoint. A mutable
   per-event `status` is **deliberately excluded** to keep the log
   tamper-evident; acknowledgement / case-management, when needed, will be a
   separate model so it cannot rewrite history. Intrinsic classification
   (`severity`, `type`, `source`, `code`) is set once at insert.

6. **Data retention.** Fraud events are forensic records; the proposed minimum
   retention is **≥ 1 year** (owner to confirm against market/regulatory needs).
   No archival/pruning job is built in this slice; the index set supports an
   age-based archive later.

7. **Future integration with call authorization.** Later slices add the
   control-plane **Authorization Decision Service** (the single chokepoint that
   returns ALLOW/DENY + a reservation). That service will *emit* `FraudEvent`s
   on every decision. This foundation defines the event store it will write to,
   with a stable shape, so the decision service plugs in without reshaping it.

8. **Separation of fraud detection from financial settlement.** Fraud
   authorization (permission to spend, a *hold*) is kept strictly separate from
   financial settlement (the Phase-13 double-entry ledger post). `FraudEvent`
   records *decisions and signals*; it never holds money, posts to a ledger, or
   stores balances. This boundary is load-bearing and is asserted here so later
   slices do not blur it.

9. **Security & failure considerations.** Reads are authenticated,
   permission-gated, and tenant-scoped; metadata is validated as a bounded,
   plain JSON object and must never contain secrets or unnecessary personal
   data. Creation is internal only in this slice (no public creation endpoint).
   The fail-closed posture of the later enforcement path (deny on Redis/DB
   outage, SEC-002) is defined in the Phase-12R plan and is **not** part of this
   read-only foundation.

## The deferred, owner-gated engine-enforcement boundary

The point at which a *live call* is actually allowed to reach a telecom engine —
the data-plane enforcement of these rails — is **explicitly out of scope** for
this ADR and for the whole control-plane foundation. It depends on two owner
decisions that are currently unresolved:

- the **delivery model** (TELECOM.md UNKNOWN #2), which determines where and how
  per-call authorization is enforced, and
- a **call-capable engine** (Kamailio `canOriginate = false`; no engine
  originates today) plus its authorization hook.

Enforcement will be its own future ADR once those are decided. Recording this
boundary as deferred does **not** block the fraud-event foundation, which stands
entirely on existing, accepted architecture.

## Status rationale (why Accepted, not Proposed)

This ADR is scoped to the fraud-event foundation (slice 12R-1). Within that
scope every decision is fully supported by existing, accepted architecture
(ADR-0004 scoping, ADR-0010 audit boundary, the append-only event pattern, the
permission catalog) and **no owner decision is unresolved** — the unresolved
items (delivery model, prepaid/postpaid, default thresholds, enforcement point)
belong to later slices and are explicitly deferred, not decided here. Therefore
it is **Accepted**. The broader toll-fraud program is tracked by the Phase-12R
implementation plan and will add its own ADRs (e.g. the enforcement-point ADR)
as those decisions land.

## Consequences

- A durable, tenant-isolated, append-only fraud-event store exists, with a
  read API, ready for later slices to write to.
- No behavior changes for any existing feature; the migration is additive and
  the new module is read-only.
- Later slices (policy authoring, kill-switch, decision service, reservations,
  alerts, engine hook) extend this foundation without reshaping it.
