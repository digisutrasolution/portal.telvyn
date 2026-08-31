# ADR-0011 — Engine runtime integration boundary

- **Status:** Accepted
- **Date:** 2026-09-01
- **Deciders:** Architect / Telecom / Security (Phase 12L)
- **Related:** ADR-0006 (control vs data plane), ADR-0007 (engine abstraction),
  ADR-0009 (credential vault), ADR-0010 (node + health model), SECURITY.md

## Context

Phase 12L turns the provider-neutral engine abstraction (ADR-0007) into a
secure, production-oriented *integration foundation*: the seams a real
Kamailio/FreeSWITCH/Asterisk adapter will plug into. Discovery confirmed **no
real telecom engine exists** in the repository or environment (infrastructure is
Postgres + Redis only). The constitution forbids faking runtime, faking health,
and speculative persistence. This ADR records the boundary decisions so they are
not re-litigated when a real adapter lands.

## Decision

- **A single connection boundary.** Only an `EngineConnector` may touch the
  network; everything above it (`EngineConnectionManager`, `EngineHealthService`,
  `EngineSyncService`, `EngineService`) is pure control-plane logic. The
  foundation ships exactly ONE connector — **`NullEngineConnector`** — which makes
  **no egress** and reports `UNKNOWN`/`UNVERIFIED`. We will NOT pretend to have
  contacted an engine that does not exist. A real connector is a future,
  drop-in implementation of the same interface.

- **Canonical SSRF egress policy.** `engine-endpoint.ts` is the single authority
  for validating a management endpoint before any egress: explicit `http(s)`
  scheme, no credentials-in-URL, no control/CRLF, and a public host only —
  blocking localhost/loopback/RFC1918/CGNAT/link-local/ULA/multicast/reserved,
  IPv4-mapped & NAT64 IPv6, and alternate IP representations (decimal/octal/hex).
  A connect-time `assertResolvedIpAllowed` re-checks the DNS-resolved IP
  (rebinding defence). Engine endpoints are **platform-configured only**
  (PlatformGuard) — never tenant input. This is distinct from the 12H
  routing-webhook check (a config-time gate for never-called URLs); this policy
  governs ACTUAL egress and is stricter.

- **Typed operations only.** Providers are driven through typed operations
  (`healthCheck`, `applyConfiguration`, future `reload`) — never
  `execute(userCommand)`. No shell, no raw ESL/AMI, no dialplan/XML/Lua from
  request input. Connection *profiles* (`connection-profiles.ts`) centralize each
  provider's management mechanism and bounded timeout/retry/backoff envelope.

- **Versioning without new schema.** The desired configuration version is the
  deterministic SHA-256 **fingerprint** of the provider-neutral
  `EngineConfigurationIntent` (secret-free; credentials are `credentialRef` ids;
  array order-independent). Version history is the existing append-only
  `TelecomConfigVersion` table (`entityType="engine"`) — **no migration**.

- **Applied-version is not persisted yet.** Because no engine exists, nothing is
  ever applied; `appliedVersion` is always `null`. Persisting an applied-version
  column now would be speculative (constitution-forbidden). When the first real
  adapter applies successfully, an additive `applied` marker (a ConfigVersion
  snapshot flag, or an additive column) is introduced *then*.

- **Idempotency, stale-downgrade, concurrency.** Sync is idempotent (skip when
  applied == desired), refuses to silently downgrade (rollback is an explicit
  op that re-proposes a prior version, append-only, never deleting history), and
  is guarded by a single-node Redis `SET NX` mutex that **fails closed** (Redis
  down → refuse, never double-apply). No distributed-lock framework is added.

- **Honest health + honest failure.** Reachability normalizes to
  `HEALTHY/DEGRADED/UNHEALTHY/UNKNOWN/DISABLED`; unproven states are `UNKNOWN`.
  Sync failure is normalized (`NOT_IMPLEMENTED → 501`, `TIMEOUT → 504`, else
  `503`); a busy lock is `409`. No fabricated success or latency.

- **Platform-only + audited.** All runtime endpoints sit behind PlatformGuard +
  permission gates; every attempt is audited (secret-free metadata) and logged
  with a correlation id via the existing observability path.

## Consequences

- A real adapter is added by implementing `EngineConnector` (+ its provider
  operations) and flipping the DI binding from `NullEngineConnector` — no change
  to controllers, versioning, security, or audit.
- The system is honest end-to-end today: health is `UNKNOWN`, sync is
  `NOT_IMPLEMENTED`, applied-version is `null`, and no packets are sent.
- No live SIP/RTP/engine runtime is introduced by this phase (deferred to a
  later, separately-authorized phase).
