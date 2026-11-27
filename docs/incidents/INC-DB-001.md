# INC-DB-001 — E2E suite reached the native PostgreSQL / Redis services

| | |
|---|---|
| Status | **Contained; corrective controls implemented (INC-DB-001B), not committed** |
| Date | 2026-11-27 (unauthorized connections ≈ 12:07–12:10 UTC) |
| Severity | Local developer environment; **no production impact reported** |
| Detected by | The engineering agent itself, immediately after the run; reported to the owner |
| Phases | INC-DB-001A (read-only investigation) → INC-DB-001B (fail-closed test safety) |
| CI verification | **PENDING — GitHub Actions NOT RUN** for the corrective change (requires an authorized push) |

Evidence labels follow the global standard: EXECUTED, OBSERVED, SOURCE-INSPECTED,
INFERRED, NOT RUN, DEFERRED.

## 1. What happened

While verifying Phase 13-2B S2, a bare `npx vitest run` was executed in `apps/api`.
The default `vitest.config.ts` at that time included `test/**/*.e2e.test.ts` and
loaded **no target guard**. Prisma loaded `apps/api/.env` at client construction,
and the E2E files carried legacy `process.env.DATABASE_URL ??= …` /
`REDIS_URL ??= …` fallbacks. As a result, the E2E suite connected to the **native
Windows PostgreSQL 17 service on `localhost:5432` (database `telvyn`, the legacy
Telvyn dev database)** and the **manually started Redis on `localhost:6379`**,
instead of the isolated `telvyn-ledger-dev` data plane (`127.0.0.1:5434` /
`127.0.0.1:6381`). The connections were unauthorized for that task. (OBSERVED.)

## 2. Findings (INC-DB-001A, read-only)

Accepted by the owner **with qualifications**:

- Unauthorized connections are **confirmed**.
- **No loss of pre-existing data was observed.** Equal insert/delete counters on
  telecom tables do not prove row identity, and the reconstruction is
  **incomplete** (statement logging was off; no WAL archive or backups found).
  This is **not** a proof of zero data loss.
- The legacy database lacks the newer schema (`User.mfaLastTotpStep`, BillingAccount,
  StepUpGrant and the ledger tables), so most suite writes failed (142 "column does not
  exist" errors, plus BillingAccount and ledger "relation missing" errors). (OBSERVED in the PG log.)
- **13 test tenants created by the run remain** in the legacy database (no
  memberships, roles or users reference them). (OBSERVED.)
- Redis command statistics showed `KEYS`, `INCR` and `EXPIRE`, and **no `DEL`**.
  `dump.rdb` was rewritten at 12:09:26 UTC; AOF is off. (OBSERVED.)
- The FMC services (`5433` / `6380`) were **not inspected** (NOT RUN, by instruction).
  Absence of impact on them is **INFERRED, not observed**: INC-DB-001A's source
  analysis found the run's targets resolved to `5432` / `6379` before the per-file
  `??=` fallbacks that named `5433` / `6380` could apply. This was not verified.

## 3. Owner decisions

- **The 13 test tenants are LEFT UNTOUCHED.** They will not be deleted, modified or
  restored. **The legacy database is not retired.** No recovery or repair is authorized.
- **No recovery, repair, restore or deletion was performed** on the legacy database or on
  the native Redis by INC-DB-001A or INC-DB-001B.
- The protected targets (native PG `5432`, native Redis `6379`, FMC PG `5433`, FMC Redis
  `6380`, every production and every unrelated or unapproved environment) must not be
  connected to, inspected or modified by any test, verification or remediation step.

## 4. Root cause

1. The default Vitest lane included E2E files with no target guard.
2. The package `test` script (`vitest run`) used that lane.
3. Prisma's automatic `apps/api/.env` load, plus the per-file `??=` fallbacks, supplied
   a real target whenever none was set explicitly. `fixture-db.ts` constructed its
   client eagerly at import, before any per-file variable assignment ran.
4. The previous guard (`setup-e2e.ts`) loaded only in the E2E config. Its CI flag
   `TELVYN_E2E_ALLOW_TARGET=1` skipped the host and database checks entirely.
5. Cleanup predicates were broad: every `@telvyn.test` user, tenants by generic name,
   `KEYS rl:*` / `KEYS fraud:*` + `DEL`, and an unscoped GLOBAL kill-switch delete.

## 5. Corrective controls (INC-DB-001B)

See `docs/SECURITY.md` §"E2E target safety" and `docs/DEVOPS.md`. In summary:

- **The default lane is unit-only.** It pins unresolvable `.invalid` data-plane sentinels.
  `pnpm test` is the unit lane; `pnpm test:e2e` is the only E2E lane.
- **Two-stage, fail-closed guard:**
  - **Gate A** runs before any connection. It checks the profile, URL syntax, protocol,
    host, published port, database, Redis DB and role names, and refuses the protected
    ports in every profile.
  - **Gate B** runs after connecting, using read-only identity probes:
    `current_database`, `current_user`, PostgreSQL ≥ 18, the restricted runtime-role
    attributes, both connections on the same server, all repository migrations applied,
    the DB marker `telvyn.e2e_instance`, and the Redis marker key and logical DB.
  - The DB marker must be a **database-level** setting. A role-level or cluster-level
    copy, a session override, or test-role database ownership is refused (review M2).
  - Gate B is necessarily post-connection. A failure aborts before any test file runs.
- **One run per instance.** An exclusive advisory-lock lease is taken after Gate B. A
  concurrent second run is refused with `INSTANCE_BUSY` (review M1).
- **No fallbacks.** All shared-target `??=` lines are removed. `fixture-db.ts` is built
  only after the guard, from the validated fixture URL only.
- **CI profile `ci-ephemeral`** requires the GitHub Actions runtime, published ports
  55432/56379 (never 5432/6379), and the CI-bootstrap markers. The retired
  `TELVYN_E2E_ALLOW_TARGET` is refused.
- **Run ownership.** Each file has a run id: users carry the run email domain; tenants
  are reached through run users; telecom names use run prefixes. Redis cleanup uses
  `SCAN` and touches only run-owned keys. A GLOBAL kill switch is deleted only if the run
  created it. There is no `FLUSHDB`, `FLUSHALL` or `KEYS`, and no trigger is ever disabled.
- **Regression tests:** mocked negative and positive guard tests, a static source scan,
  and an isolated sentinel cleanup test.
- **Verification hardening (INC-DB-001B-PRE2):**
  - Lease loss stops the workers (N2). Each worker holds a shared fence lock and
    re-verifies the lease session every second; on loss it SIGKILLs itself. A new run
    cannot start while a worker of an earlier run is connected. Bounded, not
    instantaneous (see `docs/SECURITY.md`).
  - Gate B refuses test-role membership in the database owner role (N1); Gate A
    refuses URL fragments and repeated query parameters (L1).
  - A dedicated disposable environment and explicit profile `local-verify` were used to
    verify the controls end to end: clean migration replay, privilege and drift checks,
    the full guarded E2E lane, live Gate B negatives and live lease-loss drills.

## 6. Residual risks / limitations

- The guard is a **safety interlock against configuration mistakes**. It is **not a
  security boundary** against a privileged or malicious operator, who can forge markers
  on a server they control.
- Rate-limit windows of **loopback callers** (`127.0.0.1`, `::1`) are reset in the
  disposable instance because those keys are shared by every local caller. This is
  acceptable only because Gate B has verified the instance is the marked, disposable one,
  and the run lease guarantees no other run is using it.
- E2E suites that create rows through the API (not through run-owned users or prefixes)
  may leave residue in the disposable database. They never delete beyond run scope.
- Historical residue in the disposable database from pre-INC-001B runs is not
  deleted by the new scoped cleanup.
- Instance markers are configuration interlocks, **not cryptographic identity proof**.
- Lease-loss handling is bounded, not instantaneous: a statement or Redis command
  already sent can complete, and there is no atomic cancellation across PostgreSQL and
  Redis. It assumes the worker's event loop is responsive.
- After a full verification run the disposable database still holds residue from
  suites that are not run-scoped (for example `@s1-authz.test` users and tenants with
  immutable ledger/billing rows). It was not deleted; zero residue is not claimed.
- The `local-isolated` lane obtains the application's non-database secrets through
  Prisma's `.env` auto-load of `apps/api/.env`; `local-verify` and CI supply them
  explicitly. Database and Redis targets are never taken from `.env` (Gate A).
- During verification an operator error reset the disposable `telvyn_safety_verify`
  database once (a Prisma shadow-database option pointed at it); with owner approval it
  was dropped, recreated and replayed from empty. No other service was affected.
- Evidence of the original incident remains limited to INC-DB-001A's read-only
  observations; nothing in the verification environment adds to it.
- **Not claimed:** absolute proof of zero data loss, any recovery, production readiness,
  or universal protection against privileged operators.
