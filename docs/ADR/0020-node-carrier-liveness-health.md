# ADR-0020 — Node & carrier liveness health: heartbeat vs reachability probe

- **Status:** Accepted
- **Date:** 2026-11-23 (proposed); accepted 2026-11-23 with the four review
  questions resolved (see "Resolved decisions" below)
- **Deciders:** Architect / Telecom / Security (Phase 12O)
- **Related:** ADR-0006 (control plane vs data plane), ADR-0007 (engine
  abstraction), ADR-0009 (credential vault), ADR-0010 (node + health model),
  ADR-0011 (engine runtime integration boundary); builds on Phase 12O-2au
  (node health probe), 2av (node health history), 2aw (carrier health probe),
  2ax (carrier health history).

## Context

Phases 12O-2au…2ax gave nodes and carriers an **honest operator-probe** health
posture and an append-only `HealthEvent` history. By design those probes never
report `HEALTHY`: there is no liveness source, so they resolve a posture from
configuration only — `DISABLED` (administratively disabled), `UNCONFIGURED`
(no `hostRef` / no `CarrierSipEndpoint`), otherwise `UNVERIFIED → UNKNOWN`
(ADR-0010's "no fabricated health" rule). To make node and carrier health
*real* (reach `HEALTHY`/`DEGRADED`/`UNHEALTHY` from an actual signal) we must
choose a liveness model. The obvious framings — "operator reachability probe"
vs "heartbeat / dead-man's-switch" — are **not interchangeable**, for reasons
the constitution forces us to confront:

1. **We operate nodes; we do not operate carriers.** A node is our own
   Kamailio/FreeSWITCH/Asterisk instance — we can run an agent on it. A carrier
   is a **third-party upstream** whose endpoints a tenant configures; it will
   never send *us* a heartbeat, and we cannot install anything on it.
2. **Control plane ≠ data plane (ADR-0006).** The NestJS control plane
   configures and orchestrates; it does **not** originate SIP/RTP. "Ping the
   carrier" means sending SIP `OPTIONS` to a third-party peer — a *data-plane*
   action that belongs to a media/edge node, not to the control-plane API.
3. **Tenant-directed egress is an abuse surface.** Carrier SIP endpoints are
   **tenant-supplied**. A control-plane probe to a tenant-controlled address is
   SSRF/abuse-prone and crosses the ADR-0011 egress boundary (which is
   *platform-configured only*, precisely to keep tenant input out of egress).
4. **No fabrication, no speculative schema, fail-closed** (constitution,
   ADR-0010, ADR-0011) still bind: absence of a signal must degrade *toward*
   `UNKNOWN`/stale, never toward `HEALTHY`.

A single "reachability probe" decision would either (a) make the control plane
emit SIP toward tenant-controlled carriers — violating ADR-0006 and inviting
abuse — or (b) pretend a node we can't reach is fine. We therefore decide the
model **per entity type**, and record it so it is not re-litigated when the
implementing slices land.

## Decision

### 1. Nodes → heartbeat / dead-man's-switch (push), primary

Because we operate nodes, node liveness is a **push heartbeat** with a
dead-man's-switch, not a control-plane pull:

- **Ingest.** A small agent on each node POSTs a periodic, **authenticated**
  heartbeat to a platform ingest endpoint (`POST /v1/telecom/nodes/:id/heartbeat`
  or a node-identity-scoped route). The payload is non-secret liveness only
  (node build/version, uptime, optional self-reported load); never dialplans,
  credentials, or call content.
- **Identity & auth (additive, vault).** A heartbeat is authenticated by a
  **per-node credential** — a new `TelecomCredentialType.NODE_AGENT` holding an
  **mTLS client certificate** (*decided: mTLS, not a bearer token* — it matches
  the Kamailio management plane's existing mTLS posture, is not replayable, and
  binds identity to the key, not a copyable string) — held in the vault
  (ADR-0009), with an additive nullable `TelecomNode.credentialId` FK
  (`ON DELETE SET NULL`) —
  exactly mirroring the engine's Phase 12M-1 `ENGINE_API` addition. The secret
  is decrypted only at the ingest-auth boundary (`revealForAdapter`), never
  stored on or returned from the node row. A node can only report **its own**
  health; the credential binds the heartbeat to one `nodeId` (no cross-node
  forgery).
- **Freshness is the source of truth.** `NodeHealth.lastHeartbeatAt` (which
  **already exists**, ADR-0010) is stamped on each accepted heartbeat. A
  **new, dedicated periodic evaluator** (*decided: its own cron, not folded into
  an existing sweep* — distinct cadence and failure domain from the storage/
  backup sweeps) compares `lastHeartbeatAt` to a configured TTL and records a
  transition on change, using exactly **two** states plus the administrative one:
  - **within TTL since the last heartbeat → `HEALTHY`** (the agent is alive and
    can reach us — genuine, self-reported liveness);
  - **beyond TTL → `UNKNOWN`** ("no recent heartbeat — liveness unverified"), the
    dead-man's-switch (*decided: caps at `UNKNOWN`* — see honesty rule);
  - a `DISABLED` node is `DISABLED` regardless.
  **Defaults (platform-configurable env, not hard-coded):** heartbeat interval
  `30s`; staleness TTL `90s` — the TTL is deliberately `≥ 2×` the interval so a
  single dropped beat (a network blip) does **not** flip a node to `UNKNOWN`; the
  grace window is simply this TTL slack, so no separate `DEGRADED` tier is
  invented from silence. Transitions are appended to the existing `HealthEvent`
  model (the same rows 2au/2av/2ax already read) — **no new health tables**.
- **Honesty of silence.** Loss of heartbeats means *we stopped hearing from the
  node*, which is **not** proof the node is down. The dead-man's-switch therefore
  **caps at `UNKNOWN`** and never, on silence alone, asserts `DEGRADED` or
  `UNHEALTHY` — those are claims of a *known* impairment we have not observed.
  `UNHEALTHY`/`DEGRADED` remain reachable only from a signal that genuinely
  reports impairment (a future agent self-report, or an independent corroborating
  probe such as the optional engine health probe below) — recorded by that
  signal's own path, never manufactured by the dead-man's-switch. Never `HEALTHY`
  on stale data.
- **Optional pull augmentation.** Where a node also exposes a management API
  (e.g. our Kamailio nodes behind the WireGuard+mTLS gateway), the existing
  `EngineConnector` health probe (ADR-0011) MAY corroborate the heartbeat. Any
  such pull stays behind the **single SSRF-guarded, platform-configured**
  connection boundary (ADR-0011) — it never takes a tenant-supplied address.

### 2. Carriers → NOT a control-plane probe; derived liveness, deferred

The control plane **must not** probe carriers. Carrier liveness, when we add it,
comes from a source that already lives in the data/billing plane:

- **Preferred: engine/media-reported reachability.** Our edge/media engine
  already maintains SIP `OPTIONS` keepalives to configured carriers (data
  plane). Carrier health becomes a **projection** of what the engine observes,
  reported *up* to the control plane through the existing engine integration
  boundary (ADR-0011) — i.e. the control plane *receives* carrier reachability
  from its own engine, it does not *originate* carrier SIP itself.
- **Alternative/augment: CDR-derived health.** Once CDR ingest exists (billing
  phase), carrier health can be derived from real call outcomes — seizure/answer
  ratio (ASR), recent failure rate, post-dial delay — a statistically honest
  signal with no extra egress.
- **Until then.** Carrier health **stays** the honest operator-probe posture
  from 2aw (`UNKNOWN`/`DISABLED`/posture), with the 2ax history. We explicitly
  do **not** add a control-plane carrier network probe. This keeps ADR-0006
  intact and keeps tenant-controlled addresses out of control-plane egress.

### 3. Invariants (unchanged, reaffirmed)

- No fabricated health; unproven ⇒ `UNKNOWN`; administratively off ⇒ `DISABLED`
  (ADR-0010).
- Transitions only (not every sample) persist, in the existing append-only
  `HealthEvent`; the latest snapshot stays in `NodeHealth` (ADR-0010). Carrier
  "current" health remains **derived from the latest event** (2aw), no snapshot
  table.
- Any pull egress obeys the single SSRF-guarded, platform-configured boundary
  (ADR-0011); tenant input never drives egress.
- The ingest endpoint is authenticated, rate-limited, identity-bound, and
  fail-closed (a rejected/forged/absent heartbeat never yields `HEALTHY`).

## Consequences

- **Node health can become real** without a control-plane→node pull: operate an
  agent, authenticate it, let silence degrade honestly. Reuses
  `NodeHealth.lastHeartbeatAt` + `HealthEvent`; the only additive schema is a
  node-identity credential (`NODE_AGENT` type + nullable
  `TelecomNode.credentialId`), introduced in the implementing slice via a
  reviewed, additive migration — *not now* (no speculative schema).
- **Carrier health stays honest and bounded**: no new egress, no ADR-0006
  breach; real carrier health is explicitly a projection of engine/media
  observation or CDR, deferred to those phases. The 2aw/2ax posture+history
  remain the truthful interim.
- The operator probes (2au/2aw) remain valid as the manual, zero-egress
  baseline and as the `UNCONFIGURED`/`DISABLED` resolver when no heartbeat or
  engine signal is configured.
- A new abuse surface (the heartbeat ingest) is introduced for nodes; it is
  gated by per-node credential, rate limiting, and identity binding, and is
  fail-closed. This must be reviewed against SECURITY.md in the implementing
  slice.

## Not in this ADR (implementation deferred)

This ADR records the **decision and boundaries only** — no code, no migration,
no endpoint is added here. Implementing slices (each its own review-gated,
additive sub-phase, after this ADR is Accepted):

1. **Node identity credential** — additive `NODE_AGENT` credential type +
   `TelecomNode.credentialId` (migration), vault-backed; no behaviour change yet.
2. **Heartbeat ingest** — authenticated `POST …/heartbeat`, stamps
   `lastHeartbeatAt`; rate-limited, identity-bound, audited.
3. **Dead-man's-switch evaluator** — a **new dedicated cron** comparing
   `lastHeartbeatAt` to the TTL, recording honest `HEALTHY`/`UNKNOWN` transitions
   into `HealthEvent`.
4. **(Later, separate phases)** engine-reported carrier reachability projection;
   CDR-derived carrier health.

## Resolved decisions (2026-11-23)

The four review questions are settled; this ADR is **Accepted** with them folded
into the Decision above:

1. **Dead-man's-switch caps at `UNKNOWN`.** Prolonged heartbeat silence yields
   `UNKNOWN`, never `UNHEALTHY`/`DEGRADED` on its own — silence is absence of
   evidence, not evidence of a fault. Impairment states come only from a signal
   that actually reports impairment.
2. **`NODE_AGENT` = mTLS client certificate** (not a bearer token) — matches the
   Kamailio management plane, non-replayable, identity bound to the key.
3. **A new dedicated cron** runs the evaluator — its own cadence and failure
   domain, not folded into the storage/backup sweeps.
4. **TTL defaults:** heartbeat interval `30s`, staleness TTL `90s` (≥ 2× the
   interval so one dropped beat does not flip a node to `UNKNOWN`); both
   platform-configurable env, no separate `DEGRADED`-from-silence tier. These are
   starting defaults, tunable per deployment without a contract change.
