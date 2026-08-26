# RUNBOOK.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**Empty by necessity** — no system is running. Every entry below is PLANNED and
gets written *with* the feature/infrastructure it operates, containing
copy-paste-runnable commands with real paths and hosts (never placeholders).

## Procedure index — PLANNED

1. Deploy / rollback
2. Run & verify a DB migration
3. Restore database from backup (drill-tested)
4. Rotate a compromised secret/credential
5. Suspend a customer / freeze billing
6. Investigate a stuck DID order or port request
7. CDR ingest backlog recovery
8. Fraud event lock-down
9. Incident response & post-mortem template

## On-call quick facts

| Item | Value | Status |
|---|---|---|
| Production URL | https://portal.telvyn.co | not live |
| Hosting | — | UNKNOWN |
| Escalation | — | UNKNOWN |

---

## Local auth data plane + e2e (Phase 2)

Bring up Postgres 18 + Redis, apply the schema, create an operator, run the suite:

```bash
cd "D:/Claude Dev/portal.telvyn.co"
docker compose -f docker-compose.dev.yml up -d
cp .env.example .env   # then set JWT_ACCESS_SECRET + APP_ENCRYPTION_KEY (openssl rand)
npx pnpm@9 --filter @telvyn/api exec prisma migrate dev --name init_auth
npx pnpm@9 --filter @telvyn/api test          # 13-scenario auth e2e + unit
```

Create/reset an operator login (no hardcoded credentials — supply at call time):

```bash
npx pnpm@9 --dir "D:/Claude Dev/portal.telvyn.co" --filter @telvyn/api create-operator -- ops@telvyn.co 'a-strong-passphrase-here' 'Ops One'
```

Run the API in dev (listens on :3311, health at /healthz):

```bash
npx pnpm@9 --dir "D:/Claude Dev/portal.telvyn.co" --filter @telvyn/api dev
```

---

## Tenancy + RBAC bootstrap (Phases 3+4)

After the auth data plane is up and migrated:

```bash
cd "D:/Claude Dev/portal.telvyn.co"
npx pnpm@9 --filter @telvyn/api exec prisma migrate dev --name tenancy_rbac
npx pnpm@9 --filter @telvyn/api exec prisma db seed          # permission catalog + system roles
npx pnpm@9 --filter @telvyn/api create-operator -- ops@telvyn.co 'a-strong-passphrase' 'Ops One'
npx pnpm@9 --filter @telvyn/api create-tenant   -- telvyn "Telvyn Platform" ops@telvyn.co owner
npx pnpm@9 --filter @telvyn/api test                          # unit + auth + authz e2e
```

Enable RLS defense-in-depth in production (after `prisma migrate deploy`), run as a NOBYPASSRLS role:

```bash
psql "$DATABASE_URL" -f apps/api/prisma/migrations/rls/enable-rls.sql
```
