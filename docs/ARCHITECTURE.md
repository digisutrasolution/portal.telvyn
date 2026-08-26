# ARCHITECTURE.md — Telvyn DID Portal PROMAX

> **Complete architecture audit — 2026-08-26.**
> Status taxonomy (see PROJECT_STATE.md): **EXISTING** = in the repo today ·
> **PLANNED** = locked by constitution/ADR, not built · **PROPOSED** = awaiting
> decision · **UNKNOWN** = needs owner input.

## 0. Audit basis (ground truth)

Full repository inventory at audit time: `CLAUDE.md` + 16 files under `docs/`
(this documentation set + ADR-0001). **No application code, no package
manifests, no SQL, no Dockerfiles, no CI config, no git repository exist.**
Consequently, every component below is an audit of the *designed* architecture;
nothing tagged PLANNED/PROPOSED is running anywhere. No component has an
EXISTING implementation.

Each component is audited against: purpose, dependencies, inputs, outputs,
database dependencies, external dependencies, failure modes, scaling strategy,
security risks.

---

## 1. Application architecture — PLANNED (shape PROPOSED)

- **Purpose:** overall composition of the Telvyn control plane: web portal +
  API service + background workers over one PostgreSQL system of record.
- **Status detail:** clean layering, API-first, contract-first, event-driven
  heavy work are PLANNED (constitution). The concrete shape — a **modular
  monolith** (single API deployable with strict internal module boundaries:
  identity, dids, porting, billing, cdr, audit) plus a separate worker
  process — is PROPOSED; microservices are explicitly *not* proposed at this
  scale.
- **Dependencies:** stack choice (ADR-0002, UNKNOWN).
- **Inputs:** user HTTPS traffic; carrier webhooks/API responses; schedules.
- **Outputs:** rendered portal, JSON API responses, queued jobs, audit records.
- **Database dependencies:** PostgreSQL (sole system of record).
- **External dependencies:** carrier APIs, payment rails (both UNKNOWN).
- **Failure modes:** doc/code drift (mitigated by this doc set + per-slice doc
  updates in DoD); big-bang delivery risk (mitigated by vertical-slice
  strategy).
- **Scaling strategy:** stateless app instances behind a load balancer, scaled
  horizontally; workers scale independently by queue depth.
- **Security risks:** none live yet; principal design risk is any feature
  shipping outside the constitution's gates (tests/security review in DoD).

## 2. Frontend architecture — PLANNED (charter), stack UNKNOWN

- **Purpose:** the portal UI at portal.telvyn.co — DID inventory/lifecycle,
  routing config, porting, CDRs, billing, admin.
- **Dependencies:** the versioned API only (API-first rule: no direct DB or
  service access, ever).
- **Inputs:** authenticated user interactions; API JSON.
- **Outputs:** API calls; rendered accessible UI (tokens/themes per UI_UX.md).
- **Database dependencies:** none (must remain none).
- **External dependencies:** none at runtime beyond the API (self-hosted
  fonts/assets; no third-party trackers).
- **Failure modes:** API unavailable → honest error/empty states (no fake
  data); stale generated client vs deployed contract → CI regenerates the
  client from the OpenAPI spec on every build.
- **Scaling strategy:** stateless SSR/static delivery; CDN-cacheable public
  assets; no server session affinity.
- **Security risks:** XSS (CSP + output encoding), token/session handling in
  the browser, CSRF on any cookie surface, clickjacking (frame-ancestors),
  sensitive data in client logs. All controls PLANNED in SECURITY.md.

## 3. Backend architecture — PLANNED (charter), framework UNKNOWN

- **Purpose:** the API service + workers implementing all business logic:
  identity, DID lifecycle, porting, routing config, billing, CDR, audit.
- **Dependencies:** PostgreSQL; queue + cache (§9/§10); carrier adapters.
- **Inputs:** HTTPS API requests; carrier webhooks; queue jobs; schedules.
- **Outputs:** JSON (RFC 7807 errors); DB transactions; enqueued jobs;
  outbound carrier API calls; audit log entries; notifications.
- **Database dependencies:** PostgreSQL for all state; migrations-only DDL.
- **External dependencies:** carrier APIs (UNKNOWN), payment providers
  (UNKNOWN), SMTP/notification service (UNKNOWN).
- **Failure modes:** DB outage (fail closed, surface 503, no partial writes —
  transactions only); carrier API timeout/outage (bounded timeouts, retries
  with idempotency, circuit breaker, orders parked in a retryable state);
  worker crash mid-job (at-least-once + idempotent consumers); webhook replay
  (signature verification + dedupe by event id).
- **Scaling strategy:** stateless horizontal scale-out; connection pooling to
  PostgreSQL; per-queue worker autoscaling; no in-process state.
- **Security risks:** injection (parameterized queries only), authz bypass
  (deny-by-default per-route checks), SSRF via carrier/webhook URLs (allowlist
  outbound destinations), secrets exposure (env/secret manager only), mass
  assignment (schema-validated DTOs).

## 4. Database architecture — PLANNED (PostgreSQL locked; mechanism detail open)

- **Purpose:** single system of record: tenancy/identity, DID inventory &
  lifecycle, routing, porting, orders, ledger, CDRs, audit.
- **Dependencies:** none upstream; everything depends on it.
- **Inputs:** migrations (the only DDL path); transactional writes from
  API/workers.
- **Outputs:** query results. (NOTIFY/CDC only if later ratified — not
  planned.)
- **Database dependencies:** self. PLANNED conventions: UUIDv7 PKs, FKs +
  indexes everywhere, soft deletes, audit columns, integer-minor-unit money,
  time-partitioned CDR/usage, owner id on every owned row.
- **External dependencies:** backup target (off-host, encrypted — see
  DISASTER_RECOVERY.md).
- **Failure modes:** connection exhaustion (pooling + per-service limits);
  disk growth from CDR/audit (partitioning + retention jobs); partition
  maintenance lapse (automated creation ahead of need + monitored);
  corruption/host loss (PITR per DR plan); migration failure mid-deploy
  (explicit logged migration step + tested rollback).
- **Scaling strategy:** vertical first; read replicas for reporting/CDR
  reads; partition pruning for firehose tables. Sharding explicitly out of
  scope at current (UNKNOWN but modest) scale.
- **Security risks:** cross-tenant leakage (isolation mechanism — app-scoped
  vs PostgreSQL RLS — is an open ADR; the deny-by-default requirement is
  locked); SQLi (parameterized only); backup exfiltration (encrypted at rest
  + access control); direct DB access bypassing audit (no ad-hoc prod writes;
  runbook-gated maintenance only).

## 5. Authentication architecture — PLANNED

- **Purpose:** verify identity of portal/API callers.
- **Design (locked):** argon2id password hashing; short-lived access tokens +
  rotating refresh tokens with reuse detection; server-side revocable session
  records (IP/UA); TOTP MFA — available to all, mandatory for admins, step-up
  on money/provisioning actions.
- **Dependencies:** DB (users, sessions); cache for rate limits/revocation
  (PROPOSED Redis); clock sync for TOTP.
- **Inputs:** credentials, refresh tokens, TOTP codes.
- **Outputs:** token pairs; session records; auth audit events.
- **Database dependencies:** User/Session tables; secret *references* only.
- **External dependencies:** none required (TOTP is offline); email/SMS for
  recovery flows UNKNOWN.
- **Failure modes:** refresh-token race/replay (rotation + reuse detection →
  revoke token family); clock skew breaking TOTP (±1 step window, NTP on
  hosts); cache down (revocation checks fail CLOSED, never open).
- **Scaling strategy:** stateless verification (signed access tokens);
  session/refresh state in DB+cache scales trivially with users.
- **Security risks:** credential stuffing (rate limits + lockout;
  breach-password checks PROPOSED); phishing (TOTP partially mitigates;
  WebAuthn PROPOSED as a future upgrade); token theft via XSS (storage
  strategy decided with stack ADR — httpOnly cookies PROPOSED); unenrolled-MFA
  gap (enforce enrollment at first admin login).

## 6. Authorization architecture — PLANNED (mechanism detail open)

- **Purpose:** decide what an authenticated principal may do and see.
- **Design (locked):** deny-by-default RBAC with granular permission keys
  (`did.assign`, `wallet.credit`, `cdr.read`…) checked on every route;
  data-layer enforcement of owner/tenant isolation.
- **Dependencies:** identity (§5); permission catalogue in DB; tenancy model
  (UNKNOWN — single-operator vs multi-customer/reseller decides the depth).
- **Inputs:** principal + permissions + resource ownership.
- **Outputs:** allow/deny per request; denials audited.
- **Database dependencies:** Role/Permission/UserRole tables; owner id (or
  RLS policies) on owned rows.
- **External dependencies:** none.
- **Failure modes:** route added without a guard (deny-by-default framework
  wiring makes the unguarded route fail, not pass); permission-catalogue
  drift (seed migrations + tests asserting route↔permission coverage).
- **Scaling strategy:** permission sets cached per session with explicit
  invalidation on role change; checks are in-process.
- **Security risks:** IDOR/cross-tenant reads (ownership check on every
  fetch, not just lists); privilege escalation via role-management endpoints
  (step-up MFA + audit); confused-deputy in any future admin-impersonation
  feature (requires its own ADR + audit trail if ever built).

## 7. Telecom architecture — PLANNED (state machine) / UNKNOWN (supply & delivery)

- **Purpose:** DID inventory & lifecycle, routing configuration, porting
  workflows, CDR ingest.
- **Design (locked):** DID state machine AVAILABLE → RESERVED → ASSIGNED →
  (PORTING_OUT) → RELEASED (+ PORTING_IN → ASSIGNED); every transition
  audited + permission-gated; day-one toll-fraud rails; if SIP/RTP is ever
  operated: public-IP hosts only, never behind Cloudflare, no business logic
  in media servers.
- **Dependencies:** carrier adapter layer (one interface, per-carrier
  implementations); queue for provisioning jobs; billing for charges.
- **Inputs:** carrier inventory/order/porting APIs & webhooks; user routing
  changes; CDR feeds.
- **Outputs:** provisioned/routed DIDs at the carrier; port submissions
  (LOA); normalized CDRs; billing events.
- **Database dependencies:** Did, Carrier, RoutingConfig, PortRequest, Order,
  Cdr (partitioned).
- **External dependencies:** carrier(s) — **UNKNOWN; the gating dependency**;
  CDR source (carrier files/webhooks vs own switch) UNKNOWN.
- **Failure modes:** partial provisioning (order accepted upstream but local
  write fails, or vice versa) → idempotent orders + a reconciliation job
  comparing local vs carrier state; carrier outage → park orders in explicit
  retryable states, surface status honestly; duplicate/late CDRs → dedupe on
  carrier record id + idempotent rating; port rejections → explicit state +
  user-visible reasons.
- **Scaling strategy:** provisioning via queues (burst-tolerant); CDR ingest
  as batch/stream workers writing to partitioned tables.
- **Security risks:** **toll fraud** (existential — spend/velocity/geo
  limits, balance checks before routing changes take effect); number hijack
  via forged port-out (port-out PIN/approval flow PROPOSED); LOA document
  fraud (KYC per market — UNKNOWN until markets chosen); carrier credential
  theft (vaulted, least-privilege).

## 8. Billing architecture — PLANNED (ledger) / UNKNOWN (model & rails)

- **Purpose:** charge for DIDs (NRC/MRC), usage if in scope, porting; hold
  provable balances.
- **Design (locked):** append-only double-entry ledger (Σ legs = 0 per
  transaction); balances DERIVED and reconciled, never mutated; integer minor
  units, currency-tagged; global idempotency guard on every money post; every
  movement references its source.
- **Dependencies:** DB transactions; queue for charge cycles; telecom events
  (orders, CDRs) as charge sources; payment providers (UNKNOWN).
- **Inputs:** payments/top-ups, charge events, adjustments/refund decisions.
- **Outputs:** ledger transactions, balance views, statements/invoices
  (model UNKNOWN), suspension signals at low balance.
- **Database dependencies:** LedgerAccount/Transaction/Leg; idempotency table
  (never partitioned — the unique guard must be global); Wallet/Invoice.
- **External dependencies:** payment rails — cards/PSP (PCI scope), crypto
  (AML/KYC), manual bank, UPI — all UNKNOWN pending owner decision.
- **Failure modes:** double-posting on retry (idempotency key); concurrent
  spend races (transactional balance check or reservation pattern — decided
  with the billing ADR); reconciliation mismatch (scheduled job proves
  ledger Σ = cached balances; alert on drift); FX/rounding errors (integer
  math, currency-tagged, rounding rules documented).
- **Scaling strategy:** ledger stays OLTP/non-partitioned for FK integrity;
  charge cycles run as batched jobs; read models for statements.
- **Security risks:** balance manipulation (no admin "set balance" — only
  audited adjustment postings); refund fraud (maker-checker PROPOSED for
  manual credits); payment-webhook forgery (signature verification, replay
  dedupe).

## 9. Queue architecture — PLANNED (principle) / PROPOSED (technology)

- **Purpose:** decouple heavy/async work: provisioning, porting steps, CDR
  ingest, charge cycles, notifications, reconciliation.
- **Status:** the constitution locks "queues/workers, never block a request
  thread"; the broker (Redis-backed jobs vs an AMQP broker) is PROPOSED to be
  decided inside ADR-0002 — one technology, not two, at this scale.
- **Dependencies:** broker service; workers (§3).
- **Inputs:** jobs from API/webhooks/schedulers.
- **Outputs:** executed side effects + job status; dead-letter records.
- **Database dependencies:** job outcomes persist to domain tables; the DB is
  never used as the queue (no polling tables).
- **External dependencies:** the broker itself.
- **Failure modes:** backlog growth (depth monitoring + worker autoscale);
  poison messages (bounded retries with backoff → dead-letter + alert);
  at-least-once duplicates (all consumers idempotent — same discipline as
  money posts); broker loss (durable/persistent queues; jobs re-derivable
  from DB state where possible).
- **Scaling strategy:** per-queue concurrency tuning; horizontal workers.
- **Security risks:** job payloads carry ids, not secrets/PII; broker never
  exposed publicly; any management UI behind auth.

## 10. Cache architecture — PROPOSED (Redis)

- **Purpose:** sessions/token-revocation lists, rate-limit counters, hot
  lookups (permission sets, routing snapshots).
- **Dependencies:** Redis (PROPOSED, not yet ratified).
- **Inputs/Outputs:** ephemeral keys with TTLs; explicit invalidation on
  writes to cached entities.
- **Database dependencies:** none — the cache is never the source of truth.
- **External dependencies:** the Redis service.
- **Failure modes:** stale cache after writes (write-through or targeted
  invalidation, short TTLs); cold-start stampede (jittered TTLs,
  singleflight); Redis down → **fail-safe rule: security decisions
  (revocation, rate limits) fail CLOSED; pure performance caches fall through
  to the DB**.
- **Scaling strategy:** single instance + replica initially; keyspace small.
- **Security risks:** session-data exposure (no plaintext secrets in cache;
  network-isolated, AUTH enabled); cache poisoning (server-side writes only).

## 11. Storage architecture — PROPOSED (object storage), scope UNKNOWN

- **Purpose:** documents & bulk artifacts: LOA/porting documents, CDR
  exports, statements/invoices as PDFs, backups.
- **Dependencies:** S3-compatible object store (provider UNKNOWN — follows
  the hosting decision).
- **Inputs:** generated exports; uploaded porting documents.
- **Outputs:** time-limited signed URLs — never public objects.
- **Database dependencies:** DB stores object keys + metadata, not blobs.
- **External dependencies:** the object store.
- **Failure modes:** orphaned objects (lifecycle rules + reference sweep);
  store outage (uploads/exports degrade; the core portal is unaffected).
- **Scaling strategy:** inherent to object storage; lifecycle policies per
  retention class.
- **Security risks:** public-bucket misconfiguration (deny-public by policy,
  verified in CI/runbook); PII in exports (retention limits, encryption at
  rest, signed-URL expiry); LOA documents are sensitive KYC material —
  tightest ACL in the system.

## 12. API architecture — PLANNED (see API.md for the contract itself)

- **Purpose:** the sole interface between the frontend (and any future
  customer API consumers) and the backend.
- **Design (locked):** contract-first OpenAPI 3; generated clients; `/v1`
  versioning; RFC 7807 errors; boundary validation; per-route permission
  checks; Idempotency-Key on mutations that provision or move money; cursor
  pagination; rate limiting.
- **Dependencies:** backend (§3); auth (§5/§6).
- **Inputs:** authenticated HTTPS requests; signed carrier/payment webhooks.
- **Outputs:** JSON; problem+json errors; webhook acknowledgements.
- **Database dependencies:** via the service layer only.
- **External dependencies:** none directly.
- **Failure modes:** contract drift (client regenerated from the spec in CI;
  spec diffs reviewed); breaking changes (additive-first policy; /v2 only
  with migration notes); partial-failure semantics on multi-step provisioning
  (explicit resource states instead of long-running blocking calls).
- **Scaling strategy:** stateless; scales with the backend; responses cached
  only where explicitly safe (almost nowhere — tenant data).
- **Security risks:** enumeration via ids (UUIDs + ownership checks);
  over-fetching in list endpoints (per-role field filtering); abuse (rate
  limits, request-size caps); webhook forgery (signatures + replay windows).

## 13. Infrastructure architecture — UNKNOWN (principles PLANNED)

- **Purpose:** where and how everything runs.
- **Status:** hosting target, provider, and topology are **UNKNOWN** (owner
  decision). Locked principles: everything containerized; environment parity;
  secrets in env/secret manager; only the HTTP control plane may sit behind a
  CDN/proxy (Cloudflare acceptable there); any future SIP/RTP runs on
  directly reachable public-IP hosts outside it.
- **Dependencies:** hosting decision; DNS/TLS for portal.telvyn.co (UNKNOWN;
  nothing configured as far as this repository shows).
- **Inputs/Outputs:** deploy artifacts in; running environments out.
- **Database dependencies:** managed vs self-hosted PostgreSQL — UNKNOWN.
- **External dependencies:** cloud/VPS provider, DNS, TLS issuance.
- **Failure modes:** single-host SPOF at launch (accept or reject with the
  hosting ADR; the DR plan compensates either way); provider outage
  (restore path per DISASTER_RECOVERY.md).
- **Scaling strategy:** start simple (single host or small VM set + compose),
  move to orchestration only when load demands it — PROPOSED; no premature
  Kubernetes.
- **Security risks:** host hardening (SSH policy, firewall, patching —
  runbook); exposed management ports (deny by default); secret sprawl (one
  manager, one inventory).

## 14. Deployment architecture — PLANNED (gates) / UNKNOWN (pipeline)

- **Purpose:** move reviewed code to environments safely and repeatably.
- **Design (locked):** CI on every push (lint → typecheck → tests → build);
  no red-main merges; migrations as an explicit logged step, never auto on
  boot in prod; runbook commands with real paths/hosts.
- **Dependencies:** git hosting + CI provider (UNKNOWN); container registry
  (UNKNOWN); hosting (§13).
- **Inputs:** merged commits; version tags.
- **Outputs:** immutable images; deployed releases; CHANGELOG entries.
- **Database dependencies:** migration execution against each environment.
- **External dependencies:** CI service, registry.
- **Failure modes:** mid-deploy migration failure (backward-compatible
  migration policy: expand → deploy → contract); bad release (rollback
  runbook + previous image retained); config drift between envs (single
  source `.env.example` + parity checks).
- **Scaling strategy:** n/a — pipeline throughput is not a constraint.
- **Security risks:** CI secret exposure (scoped tokens, no secrets in
  logs); supply chain (lockfiles + dependency-audit gate); unsigned images
  (registry access control; image signing PROPOSED later).

## 15. Monitoring architecture — PLANNED (signals) / UNKNOWN (stack)

- **Purpose:** know the system is healthy, and prove it when it isn't.
- **Design:** signal inventory PLANNED in MONITORING.md — API latency/error
  rates, correlation-id logs, DB health, queue depth, and business signals
  (stuck orders/ports, payment failures, fraud-limit trips, ledger
  reconciliation drift). Stack (self-hosted vs hosted) UNKNOWN — follows the
  hosting decision.
- **Dependencies:** instrumented app (built with features, not after); the
  observability stack.
- **Inputs:** metrics, structured logs, traces, health checks.
- **Outputs:** dashboards; actionable alerts, each mapped to a RUNBOOK entry.
- **Database dependencies:** exporter/read-only access for DB metrics.
- **External dependencies:** alert delivery channel (UNKNOWN).
- **Failure modes:** blind spots (coverage reviewed per slice in DoD); alert
  fatigue (actionable-only policy); monitoring itself down = silent failure
  (heartbeat/dead-man's-switch alert PROPOSED).
- **Scaling strategy:** trivial at expected volumes; CDR-scale metrics are
  aggregated, not per-event.
- **Security risks:** logs leaking PII/secrets (structured logging with
  redaction rules); exposed dashboards (auth in front of all observability
  UIs).

## 16. Security architecture — PLANNED (cross-cutting; see SECURITY.md)

- **Purpose:** the control set every component above inherits.
- **Summary of controls:** argon2id + rotating refresh + TOTP/step-up (§5);
  deny-by-default RBAC + data-layer isolation (§6); boundary validation,
  parameterized queries, CSP, CSRF protection, rate limiting; audit on all
  mutations; secrets only in managers; dependency audit in CI; security
  review inside the definition of done.
- **Dependencies:** all components; compliance obligations UNKNOWN (follow
  from launch markets + payment rails).
- **Inputs:** threat landscape; audit findings.
- **Outputs:** enforced controls; audit trail; incident procedures (RUNBOOK).
- **Database/External dependencies:** secret manager (UNKNOWN); vulnerability
  feeds via CI tooling.
- **Failure modes:** control regression over time (tests assert the guards:
  authz coverage, validation presence); alert-less incidents (fraud/velocity
  monitors are day-one, not later).
- **Scaling strategy:** controls are per-request and scale with the app.
- **Top risk register (ranked):**
  1. **Toll fraud / routing abuse** — existential; spend & velocity rails
     ship with the first call-affecting feature, not later.
  2. **Billing integrity** — double-posting, races, manipulated balances;
     ledger + idempotency + reconciliation are the mitigations.
  3. **Cross-tenant/customer data leakage** — the isolation-mechanism ADR is
     a Phase-1 gate.
  4. **Port-out hijacking & LOA fraud** — process controls decided with the
     porting design.
  5. **Credential/secret compromise** — manager-only secrets + rotation
     runbook.
  6. **Supply-chain compromise** — lockfiles + audit gates in CI.

---

## Cross-reference

DATABASE.md · API.md · TELECOM.md · BILLING.md · SECURITY.md · UI_UX.md ·
DEVOPS.md · MONITORING.md · DISASTER_RECOVERY.md · RUNBOOK.md · ADR/
