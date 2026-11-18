# ADR-0019 — NOC mutating actions (engine health-check / sync / rollback)

- **Status:** Accepted (owner-authorized Phase 12O-2i; implemented 2026-11-18)
- **Date:** 2026-11-18
- **Deciders:** Architect / Security / Frontend
- **Related:** ADR-0017 (permission-aware gating), ADR-0018 (NOC read pages).
  First state-changing actions in the frontend.

## Context

The NOC was read-only. The engine endpoints also expose three POST actions —
`health-check` (non-destructive probe), `sync` (push desired config), and
`sync/rollback`. Sync and rollback change engine state once a real connector is
wired (today they return a normalized `501 NOT_IMPLEMENTED` under the Null
connector). The frontend needs to drive these safely, honestly, and without ever
becoming an authorization authority.

## Decision

Add an `<EngineActions>` panel on the engine detail page.

- **Permission-gated buttons.** Check-health shows only with
  `telecom.health.read`; Sync and Rollback only with `telecom.manage`. The
  server (PlatformGuard + the same permission) re-checks every call — the gate is
  UX, so a hidden button never implies access.
- **Confirm before state change.** Health-check fires directly (non-destructive).
  Sync and Rollback open a confirm dialog that states plainly that they push /
  roll back engine config once a real connector is wired. (The owner chose a
  confirm dialog over a type-the-name guard for this stage.)
- **No auto-retry.** Mutations go through the client, which never auto-retries —
  a failed or ambiguous sync is never silently replayed (double-apply risk). One
  action in flight disables the panel.
- **Honest results.** The outcome is shown plainly: a successful `SyncOutcome`
  as `outcome — syncState`, and failures by their RFC 7807 title. The expected
  `501` under the Null connector is shown in a neutral/info tone (it is honest,
  not a fault), while `409`/`5xx`/`400` are warnings.
- **Refresh after.** Every action reloads the engine + status so the view
  reflects any change (e.g. a new health reading).

## Options considered

1. **No confirm (buttons act immediately).** Rejected — sync/rollback are
   state-changing; the constitution confirms before irreversible/outward actions.
2. **Type-the-engine-name to confirm.** A stronger guard; deferred — the confirm
   dialog is sufficient while the connector is a stub and the action is a no-op.
   Can be raised to type-to-confirm when a real connector is wired.
3. **Confirm dialog + permission gating + honest results (chosen).**

## Consequences

- The NOC gains its first write path, safely: gated, confirmed, non-retrying,
  honest. Still no fabricated success — `501` surfaces as-is.
- `<EngineActions>` reuses the client (no-retry), the session (`hasPermission`),
  the Dialog primitive, and the shared `messageFor`. No new dependency.
- Covered by unit tests (actions POST the right paths; gating by permission;
  health-check direct; sync confirm → honest 501; rollback cancel) and a build.
- Contract now covers the three POST endpoints (+ `EngineHealthReport`,
  `SyncOutcome`). No backend/API/schema/DI change; production stays on
  `NullEngineConnector`, so sync/rollback remain `NOT_IMPLEMENTED`.