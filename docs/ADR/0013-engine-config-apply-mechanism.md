# ADR-0013 — Kamailio configuration apply mechanism

- **Status:** Accepted (owner-approved; mechanism implemented in 12N-4b — the live
  mutation against the disposable VPS remains operator-gated, Phase 5)
- **Date:** 2026-11-17
- **Deciders:** Architect / Telecom / Security
- **Related:** ADR-0006 (control vs data plane), ADR-0007 (engine abstraction),
  ADR-0011 (runtime integration boundary + applied-version), ADR-0012 (assignments)

## Context

Phases 12N-1…12N-4a built everything up to — but not including — a real config
**push**: resources are assigned to an engine (12N-1/2), the desired intent is
built from them (12N-3), and the applied-version state machine is in place
(12N-4a). What remains is the actual translation of the desired intent into real
Kamailio state. Today the Kamailio adapter's `applyConfiguration` is an honest
stub (`NOT_IMPLEMENTED`), so every apply is `FAILED` and the applied version never
advances.

A real apply **mutates a live engine**, so the mechanism is a decision to make
deliberately, not by default. The constitution forbids string-concatenated or
`exec`-ed generated config; whatever we push must be via **typed, validated,
idempotent operations**.

## Options considered

1. **DB-backed Kamailio modules (dispatcher/drouting/domain) + reload RPC.**
   Telvyn writes rows into Kamailio's own DB tables, then calls
   `dispatcher.reload` etc. — the "standard" production pattern. **Cost:** requires
   provisioning a Kamailio DB, configuring the modules in `db_mode`, and giving the
   control plane write access to that DB (a second data path besides the mgmt RPC).
   Large infra + security surface; deferred.

2. **`htable` (in-memory hash table) via JSON-RPC.** Kamailio exposes
   `htable.sets`/`htable.seti`/`htable.delete`/`htable.dump` RPC commands that
   manage named in-memory tables at runtime — **no Kamailio DB required**. Telvyn
   would push, e.g., the assigned DIDs/trunks as typed key/value entries, diffing
   the live table (`htable.dump`) against the desired set and issuing per-entry
   `sets`/`delete`. Each key/value is individually validated (E.164, no CRLF, length
   bounds). It is idempotent, bounded (per-entry RPC under the existing timeout
   envelope), verifiable, and needs only a one-line `htable` declaration in the VPS
   `kamailio.cfg`. **Chosen direction** for the first real apply.

3. **Generated config file + full reload.** Rejected — rendering a config blob and
   reloading it is exactly the string-concat/exec risk the constitution forbids, and
   a full reload is not a bounded, idempotent, per-field operation.

## Proposed decision (for approval)

- Implement `applyConfiguration` for Kamailio as an **htable diff-and-apply** over
  JSON-RPC (option 2), driven through the existing connector/transport (mTLS,
  rebinding recheck, bounded timeouts). The adapter decides the typed operations;
  the connector sends them. No string-built config, no `exec`.
- The target htable (e.g. `telvyn`) is declared in the VPS `kamailio.cfg`
  (`loadmodule "htable.so"` + one `modparam`). Until it exists, apply stays honest
  `NOT_IMPLEMENTED`.
- A **timeout** mid-apply leaves the engine in an unknown state → the 12N-4a
  machinery records `PENDING_RECONCILIATION` and never claims applied; a later
  apply reconciles by re-diffing against `htable.dump`.
- Verified live via an **opt-in** integration test against the disposable VPS
  (like 12M-4), never in CI.

## Consequences (once accepted)

- This is the first operation that **changes engine state**; it ships env-gated and
  review-gated, and is proven against the disposable test engine only.
- It does not alter the control-plane contract, the applied-version persistence, or
  the security boundary — it fills in the adapter's apply with real, typed work.
- DB-backed modules (option 1) remain available for a later, higher-scale phase if
  the resource model outgrows in-memory htables.

## Implementation (Phase 12N-4b)

- `htable-config.ts` (pure): `buildDesiredEntries` (validate + bound; reject a
  malformed set whole, never a partial push), `diffEntries` (deterministic,
  idempotent; deletes stale **managed** keys only — foreign keys untouched),
  `parseDumpEntries` (defensive — managed, safe keys only). Keys are namespaced
  (`did:`/`trunk:`/`route:`), non-numeric; values derive only from safe fields.
- `KamailioJsonRpcConnector.applyConfiguration`: dump → diff → bounded
  `htable.sets`/`htable.delete` → **re-dump verify**. Returns `OK` only when the
  re-dump equals desired; `APPLY_INCOMPLETE` on mismatch; `TIMEOUT` →
  PENDING_RECONCILIATION (12N-4a); mTLS cred revealed at the boundary, never logged.
  Only the `telvyn` htable is ever named. `NullEngineConnector` stays
  NOT_IMPLEMENTED; apply routes through `EngineConnectionManager` (SSRF guard).
- **VPS prerequisite (operator):** `kamailio.cfg` must `loadmodule "htable.so"` and
  `modparam("htable", "htable", "telvyn=>size=8;")`. Until then, apply is honest
  UNAVAILABLE/NOT_IMPLEMENTED.
- Covered by unit tests (fake in-memory htable transport) + an **opt-in** live test
  (`telecom-engine-apply-live.e2e.test.ts`, skipped unless `ENGINE_LIVE_MTLS_DIR`).
  Production DI stays `NullEngineConnector`. The live mutation is operator-gated.
