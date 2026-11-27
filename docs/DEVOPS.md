# DEVOPS.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**Nothing provisioned.** No git repo initialized, no CI, no Dockerfiles, no
hosting, no DNS/TLS configured for portal.telvyn.co.

## Principles — PLANNED (locked by constitution)

- Everything containerized; environment parity
- CI on every push: lint → typecheck → tests → build; no red-main merges
- Migrations run as an explicit, logged deploy step — never auto on boot in prod
- Zero secrets in the repo; `.env.example` documents every variable
- Ops commands documented with REAL paths/hosts — copy-paste runnable

## Environments — PROPOSED

| Env | Purpose | Host |
|---|---|---|
| local | development, one-command bootstrap via docker compose | dev machine |
| staging | pre-prod verification | UNKNOWN |
| production | portal.telvyn.co | UNKNOWN |

## UNKNOWN

- Hosting target (VPS/cloud/k8s) and deploy pattern
- DNS/TLS/CDN posture (note: only the HTTP control plane may sit behind a
  CDN/proxy — any future SIP/RTP must not; see TELECOM.md)
- CI provider (follows git hosting choice)

## Isolated ledger dev/test environment (Phase 13-1) — EXISTING

A dedicated, **non-production, localhost-only** data plane for Ledger Foundation
work (Phase 13-1, ADR-0022). Completely separate from any other environment: its
own Compose project (`telvyn-ledger-dev`), network and named volume. Ports:
PostgreSQL 18 on `127.0.0.1:5434`, disposable Redis on `127.0.0.1:6381`.
Databases: `telvyn_ledger_dev` (baseline) and disposable `telvyn_ledger_e2e`.

**Secrets** live only in gitignored files (never committed): copy
`.env.ledger-dev.example` → `.env.ledger-dev` and set a strong `POSTGRES_PASSWORD`;
the least-privilege role credentials live in `.env.ledger-dev.roles`.

```bash
# From the repo root (D:\Claude Dev\portal.telvyn.co)

# 1. Provision the isolated PG18 + disposable Redis
docker compose -p telvyn-ledger-dev -f docker-compose.ledger-dev.yml \
  --env-file .env.ledger-dev up -d

# 2. Bootstrap least-privilege roles + database/schema grants (run as the
#    isolated bootstrap admin; pass the target DB via -v db_name=...).
#    telvyn_migrator = DDL/owner, telvyn_ledger_fn = NOLOGIN (future fn owner),
#    telvyn_app = restricted runtime. Scripts are fail-closed + idempotent.
Get-Content scripts/db/ledger-dev-bootstrap.sql | docker exec -i telvyn-ledger-dev-pg \
  psql -U telvyn_ledger_admin -d telvyn_ledger_dev -v db_name=telvyn_ledger_dev -v ON_ERROR_STOP=1 -f -

# 3. Apply the baseline migrations + seed AS telvyn_migrator, then the runtime grants
#    (set DATABASE_URL to the migrator URL from .env.ledger-dev.roles)
cd apps/api
npx prisma migrate deploy      # 16 baseline migrations
npx prisma db seed             # permission catalog + system roles
cd ../..
Get-Content scripts/db/ledger-dev-grants.sql | docker exec -i telvyn-ledger-dev-pg \
  psql -U telvyn_ledger_admin -d telvyn_ledger_dev -v db_name=telvyn_ledger_dev -v ON_ERROR_STOP=1 -f -
```

**Isolated E2E regression** (hardened by INC-DB-001B, see `docs/incidents/INC-DB-001.md`)
runs the full suite against `telvyn_ledger_e2e`, with the app as `telvyn_app` and the
fixtures as `telvyn_migrator`. It runs **only** through the guarded E2E lane:

- **Gate A** (before any connection) requires `TELVYN_E2E_PROFILE` plus explicit
  `DATABASE_URL`, `E2E_FIXTURE_DATABASE_URL` and `REDIS_URL` matching the profile allowlist.
- **Gate B** (after connecting, read-only) verifies the server identity and the
  instance markers before any test file runs.
- **One run per instance.** An exclusive PostgreSQL advisory-lock lease is taken after
  Gate B. A second concurrent run on the same instance is refused with
  `INSTANCE_BUSY`; wait for the other run to finish. A crashed run's lease is freed
  when its session ends.
- The wrapper exits with the lane's real exit code (non-zero on refusal or failure).
- Ports 5432/5433/6379/6380 are refused in every profile. There is no `.env` or
  default fallback.

```powershell
# From the repo root. Once per Redis container start (the isolated Redis is
# non-persistent) and once after (re)creating telvyn_ledger_e2e: apply the markers.
powershell -File scripts/test/e2e-local.ps1 -Mark
# Full guarded E2E lane (reads .env.ledger-dev.roles; never prints credentials)
powershell -File scripts/test/e2e-local.ps1
# Selected files
powershell -File scripts/test/e2e-local.ps1 -Files test/auth.e2e.test.ts,test/authz.e2e.test.ts
```

Equivalent manual form (from `apps/api`): set `TELVYN_E2E_PROFILE=local-isolated`,
`DATABASE_URL` → `telvyn_app@127.0.0.1:5434/telvyn_ledger_e2e`,
`E2E_FIXTURE_DATABASE_URL` → `telvyn_migrator@127.0.0.1:5434/telvyn_ledger_e2e`,
`REDIS_URL=redis://127.0.0.1:6381/0`, then run `pnpm test:e2e`.

`pnpm test` and a bare `vitest run` are the **unit lane only**: they include no E2E
file and pin unresolvable `.invalid` data-plane sentinels. A bare `vitest run` cannot
reach any database or Redis.

Markers:
- DB: `scripts/db/e2e-instance-marker.sql` sets `telvyn.e2e_instance` with
  `ALTER DATABASE` (database level). It accepts only
  (`telvyn_ledger_e2e`, `telvyn-e2e/local-isolated`), the local-verify pair
  (`telvyn_safety_verify`, `telvyn-inc-db-001b-local-verify`), the verify-clean pair
  (`telvyn_clean_verify`, `telvyn-verify-clean`) and the CI pair. Gate B refuses
  the marker if it is also set at role or cluster level. Never set it with
  `ALTER ROLE`.
- Redis: `pnpm --filter @telvyn/api e2e:mark-redis` runs Gate A first, then writes the
  single key `telvyn:e2e:instance-marker`.

Remote CI runs the same guarded lane with the `ci-ephemeral` profile against its
ephemeral service containers (see below).

**Safety-verification environment — profile `local-verify`** (INC-DB-001B-PRE2). A
dedicated, disposable, loopback-only data plane used to verify the E2E safety
controls end to end. It is separate from `telvyn-ledger-dev` and never uses the
ports 5432/5433/5434 or 6379/6380/6381.

| Item | Value |
|---|---|
| Compose project / file | `telvyn-inc-db-001b-verify` / `docker-compose.local-verify.yml` |
| PostgreSQL | `telvyn-inc-db-001b-verify-pg`, `postgres:18-alpine`, `127.0.0.1:5435`, DB `telvyn_safety_verify`, bootstrap superuser `telvyn` (owns the DB) |
| Redis | `telvyn-inc-db-001b-verify-redis`, `redis:7-alpine`, `127.0.0.1:6382`, DB 0, no persistence |
| Volume / network | `telvyn_inc_db_001b_verify_pgdata` / `telvyn-inc-db-001b-verify_net` |
| Secrets | gitignored `.env.inc-db-001b-verify` at the repo root: `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`, `JWT_ACCESS_SECRET`, `APP_ENCRYPTION_KEY` — random per environment, never printed or committed |
| Markers | DB `telvyn.e2e_instance = telvyn-inc-db-001b-local-verify` (database level only); Redis key `telvyn:e2e:instance-marker` |

Provisioning order (repo root; the bootstrap reuses the unmodified CI scripts against
this cluster, run as `telvyn` through `docker exec` into the verify container):

1. `docker compose --env-file .env.inc-db-001b-verify -p telvyn-inc-db-001b-verify -f docker-compose.local-verify.yml up -d`
2. Confirm `telvyn_safety_verify` is empty (no user objects, no `pg_db_role_setting` rows).
3. `scripts/db/ci-bootstrap-roles.sql` (`-v ci_ephemeral=1 -v db_name=telvyn_safety_verify`), then
   `ALTER ROLE … PASSWORD` for `telvyn_migrator` / `telvyn_app` from the env file.
4. `scripts/db/ledger-migration-pre.sql` (`-v db_name=telvyn_safety_verify -v allow_ci=1`).
5. `prisma migrate deploy` and `prisma db seed` from `apps/api` with `DATABASE_URL` = the
   `telvyn_migrator` URL on 5435.
6. `scripts/db/ledger-migration-post.sql` (always), `scripts/db/ci-bootstrap-grants.sql`,
   `scripts/db/ledger-drift-check.sql` (admin), `scripts/db/ci-privilege-check.sql` (as `telvyn_app`).
7. `powershell -File scripts/test/e2e-local.ps1 -Profile local-verify -Mark`
8. `powershell -File scripts/test/e2e-local.ps1 -Profile local-verify` (full lane) or
   `… -Profile local-verify -Files test/auth.e2e.test.ts`.

Never point `prisma migrate diff --shadow-database-url` (or any shadow-database option)
at a verification database: Prisma resets the shadow database. Changing the database
owner and back (`ALTER DATABASE … OWNER`) folds the previous owner's explicit CONNECT
grant into the owner entry; re-grant `CONNECT` to `telvyn_migrator` after such a drill.

Lease drills (local-verify only): `TELVYN_E2E_LEASE_DRILL=loss` or `setup-fail` with
`-Files test/e2e-lease-drill.e2e.test.ts`. For `loss`, terminate the lease session
(`application_name = 'telvyn-e2e-lease'`) or a worker fence session
(`'telvyn-e2e-fence'`) **inside `telvyn-inc-db-001b-verify-pg` only**. The drill file is
skipped in every other profile and when the variable is unset.

Retention: the environment is retained until the owner authorizes cleanup. Proposed
cleanup (not executed; requires explicit authorization):

```powershell
docker compose --env-file .env.inc-db-001b-verify -p telvyn-inc-db-001b-verify -f docker-compose.local-verify.yml down
docker volume rm telvyn_inc_db_001b_verify_pgdata
```

**Clean verification environment — profile `verify-clean`** (Phase 13-2B S5). A second disposable,
loopback-only data plane built from an empty database, so migration checksums can be verified exactly
(the retained `local-verify` database keeps its known S4 checksum mismatch and is not modified).

| Item | Value |
|---|---|
| Compose project / file | `telvyn-verify-clean` / `docker-compose.verify-clean.yml` |
| PostgreSQL | `telvyn-verify-clean-pg`, `postgres:18-alpine`, `127.0.0.1:5436`, DB `telvyn_clean_verify`, bootstrap superuser `telvyn` |
| Redis | `telvyn-verify-clean-redis`, `redis:7-alpine`, `127.0.0.1:6383`, DB 0, no persistence |
| Volume / network | `telvyn_verify_clean_pgdata` / `telvyn-verify-clean_net` |
| Secrets | gitignored `.env.verify-clean` at the repo root (same keys as `.env.inc-db-001b-verify`) — never printed or committed |
| Markers | DB `telvyn.e2e_instance = telvyn-verify-clean` (database level only); Redis key `telvyn:e2e:instance-marker` |

Provisioning order: identical to `local-verify` steps 1–8 above, with `-p telvyn-verify-clean -f
docker-compose.verify-clean.yml --env-file .env.verify-clean`, `db_name=telvyn_clean_verify`, port 5436 and
`-Profile verify-clean`:

```powershell
docker compose --env-file .env.verify-clean -p telvyn-verify-clean -f docker-compose.verify-clean.yml up -d
powershell -File scripts/test/e2e-local.ps1 -Profile verify-clean -Mark
powershell -File scripts/test/e2e-local.ps1 -Profile verify-clean
```

Later migrations are applied additively (pre → `prisma migrate deploy` + seed → post → grants → drift →
privilege check); never reset. Retention: kept until the owner authorizes cleanup (`docker compose … down`
and `docker volume rm telvyn_verify_clean_pgdata`, not executed).

## CI restricted-role bootstrap (Phase 13-1A.7A) — EXISTING

Ordinary remote CI (`.github/workflows/ci.yml`) spins a **fresh ephemeral**
`postgres:18-alpine` with only its bootstrap admin (`telvyn`). To exercise the
same least-privilege model as the isolated dev cluster — and so the future
financial migration's role-specific DDL works in CI — the workflow bootstraps the
ledger roles before migrating. No financial ledger objects are created in this
slice; `ledger_post` and the four ledger models remain Phase 13-1B+C.

The privileged bootstrap target is **constructed explicitly** (`CI_PG_ADMIN_URL`),
not a job-wide `DATABASE_URL`, so ordinary test/build steps cannot connect as the
bootstrap admin. A **Verify CI database target** step asserts PostgreSQL ≥ 18 +
`current_database=telvyn` + `current_user=telvyn` + GitHub-Actions context before
bootstrapping, and the bootstrap script additionally fails closed on a missing
`ci_ephemeral=1` flag, a mismatched DB name, an already-migrated database
(`_prisma_migrations` present), or a pre-existing role with unexpected
attributes/memberships. (A SQL script cannot itself establish Docker/GitHub
service identity — that is the workflow's responsibility.)

CI sequence (`build-test` job):
1. `scripts/db/ci-bootstrap-roles.sql` (as `telvyn` admin, `-v ci_ephemeral=1 -v
   db_name=telvyn`) creates `telvyn_migrator` (LOGIN, owns schema objects),
   `telvyn_ledger_fn` (NOLOGIN, future SECURITY DEFINER function owner — no
   privileges yet), `telvyn_app` (restricted runtime); fail-closed on unexpected
   role state; PUBLIC hardened; no blanket/default future-table grants.
2. Per-run **ephemeral** passwords (`openssl rand -hex`, GitHub-masked) are set on
   the login roles; restricted connection strings are exported (masked).
3. `prisma migrate deploy` + `db seed` run **as `telvyn_migrator`**.
4. `scripts/db/ci-bootstrap-grants.sql` grants `telvyn_app` the runtime matrix
   (SELECT/INSERT/UPDATE/DELETE on business tables; SELECT+INSERT only on
   audit/event tables; nothing on `_prisma_migrations`).
5. `scripts/db/ci-privilege-check.sql` runs **as `telvyn_app`** and fails closed
   if the runtime role is over-privileged (SQLSTATE-precise negatives).
6. **Mark ephemeral E2E instance** (INC-DB-001B):
   `scripts/db/e2e-instance-marker.sql` (`-v db_name=telvyn -v
   marker=telvyn-e2e/ci-ephemeral -v ci_ephemeral=1`) and
   `pnpm --filter @telvyn/api e2e:mark-redis`.
7. `pnpm -r test` runs the **unit lane only** (no data-plane variables).
8. `pnpm --filter @telvyn/api test:e2e` runs the guarded E2E lane:
   - `TELVYN_E2E_PROFILE=ci-ephemeral`;
   - `DATABASE_URL`=`telvyn_app` and `E2E_FIXTURE_DATABASE_URL`=`telvyn_migrator`
     (app = restricted runtime, setup/teardown = migrator fixture; no
     bootstrap-admin fallback);
   - Gate A requires `GITHUB_ACTIONS=true` + `CI=true` and the published ports;
   - Gate B requires the markers from step 6, the restricted-role attributes and
     all migrations applied.

The CI services publish PostgreSQL on **55432** and Redis on **56379**; the
container ports stay 5432/6379. No CI target ever names a protected native port.

This whole sequence is validated against a **faithful fresh disposable cluster**
(`postgres:18-alpine`, db/user `telvyn`) that mirrors the CI service — local
CI-equivalent verification; it has **not** yet run in an actual GitHub Actions
execution (that requires a push). No financial ledger objects exist yet.

**Future financial-migration ownership transfer (13-1B+C), proven on PG 18:** a
`SECURITY DEFINER` function is transferred to `telvyn_ledger_fn` by (a) granting
`telvyn_ledger_fn TO telvyn_migrator WITH INHERIT FALSE, SET TRUE` (required —
`ALTER FUNCTION … OWNER TO` needs SET-membership; this is a *privileged deployment*
capability that the runtime role must never receive), (b) granting the fn owner
**temporary** `CREATE` on its schema (PG requires the new owner to have schema
CREATE to receive ownership) plus persistent `USAGE`, (c) transferring ownership,
(d) revoking the temporary `CREATE`, (e) managing the ACL (`REVOKE EXECUTE FROM
PUBLIC`, `GRANT EXECUTE TO telvyn_app`) as the owner. The `WITH SET TRUE`
membership is established just-in-time for the migration window and removed by the
bootstrap admin afterward; the runtime role (`telvyn_app`) never holds it.

## To fill in as they land

Dockerfiles / production compose · deploy runbook (RUNBOOK.md) · staging/prod hosting
