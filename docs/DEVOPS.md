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

**Isolated E2E regression** runs the full suite against `telvyn_ledger_e2e` with the
app as `telvyn_app` and fixtures as `telvyn_migrator`, via a dedicated config +
fail-closed guard (refuses shared ports 5432/5433/6379/6380):

```bash
cd apps/api
# DATABASE_URL -> telvyn_app@127.0.0.1:5434/telvyn_ledger_e2e
# E2E_FIXTURE_DATABASE_URL -> telvyn_migrator@127.0.0.1:5434/telvyn_ledger_e2e
# REDIS_URL -> redis://127.0.0.1:6381
npx vitest run --config vitest.e2e.config.ts
```

The repository CI (`.github/workflows/ci.yml`) is unaffected: it runs `pnpm -r test`
on the base `vitest.config.ts` (the guard is not loaded) and `fixture-db.ts` falls
back to `DATABASE_URL`. Remote CI runs the suite as a single privileged role and
does **not** prove the restricted-role enforcement — that is verified locally only.

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
6. The test suite runs with `DATABASE_URL`=`telvyn_app` and
   `E2E_FIXTURE_DATABASE_URL`=`telvyn_migrator` (app = restricted runtime,
   setup/teardown = migrator fixture; no bootstrap-admin fallback).

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
