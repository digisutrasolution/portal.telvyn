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
psql "$DATABASE_URL" -f apps/api/prisma/rls/enable-rls.sql
```

---

## Local dev WITHOUT Docker (this machine — PostgreSQL 17 + Redis already running)

Docker isn't installed here; the workspace's local PostgreSQL 17 (:5432) and
Redis (:6379) are used instead. PG17 lacks native `uuidv7()`, so a polyfill is
applied once. `apps/api/.env` points at :5432/:6379 (gitignored).

```bash
# 1. As the postgres superuser — create the role + database (one time):
& "D:\Claude Dev\pgsql\bin\psql.exe" -U postgres -h localhost -p 5432 -v ON_ERROR_STOP=1 -c "CREATE ROLE telvyn LOGIN PASSWORD 'telvyn_dev' CREATEDB;" -c "CREATE DATABASE telvyn OWNER telvyn;"
# 2. Install the uuidv7() polyfill into the telvyn DB (one time):
$env:PGPASSWORD='telvyn_dev'; & "D:\Claude Dev\pgsql\bin\psql.exe" -U telvyn -h localhost -p 5432 -d telvyn -f "D:\Claude Dev\portal.telvyn.co\apps\api\prisma\pg17-uuidv7.sql"
# 3. Point the session at the local ports (overrides any stale env), then migrate/seed/test:
$env:DATABASE_URL='postgresql://telvyn:telvyn_dev@localhost:5432/telvyn?schema=public'; $env:REDIS_URL='redis://localhost:6379'
npx pnpm@9 --filter @telvyn/api exec prisma migrate dev
npx pnpm@9 --filter @telvyn/api exec prisma db seed
npx pnpm@9 --filter @telvyn/api test
```

---

## Live engine management plane — Kamailio over mTLS/WireGuard (Phase 12M-4)

The first real engine connector (`KamailioJsonRpcConnector`) proven end-to-end
against a disposable Kamailio 6.1 test engine. The management plane is PRIVATE:
WireGuard transport + an nginx mTLS gateway; SIP/RTP stay closed. Default is
unchanged (`NullEngineConnector`) until `ENGINE_CONNECTOR=kamailio` is set.

**VPS (dedicated, `167.114.98.53` / host `vps-9345109a`, Ubuntu 24.04):**
- Kamailio JSON-RPC on loopback only: `/etc/kamailio/kamailio.cfg` = a
  management-only config (`listen=tcp:127.0.0.1:8000`, `xhttp` + `jsonrpcs`
  `transport=1`, `event_route[xhttp:request]` → `127.0.0.1` source check →
  `^/RPC` → `jsonrpc_dispatch()`). No public SIP. Verify:
  `curl -s -X POST http://127.0.0.1:8000/RPC -d '{"jsonrpc":"2.0","method":"core.version","id":1}'`
- mTLS gateway: `/etc/telvyn/mtls/` holds `ca.{crt,key}`, `server.{crt,key}`
  (SAN `IP:10.9.0.1`), `client.crt`. nginx site `engine-mgmt` listens
  `10.9.0.1:8443 ssl` (`ssl_verify_client on`) → `proxy_pass http://127.0.0.1:8000/RPC`.
  Port opened on the tunnel only: `ufw allow in on wg0 to any port 8443 proto tcp`.
- WireGuard: `wg0 = 10.9.0.1/24`, port `51820`; control-plane peer `10.9.0.2`.

**Control-plane host (this dev box = `10.9.0.2`):** WireGuard for Windows tunnel
(AllowedIPs `10.9.0.1/32`, endpoint `167.114.98.53:51820`). The `ENGINE_API`
vault credential's secret is a JSON mTLS bundle `{"cert","key","ca"}`; the client
private key is generated here and never leaves (only its CSR goes to the VPS CA).

**Prove it (from `apps/api`, services up):**
```bash
node -r @swc-node/register scripts/probe-live-engine.ts "<dir with client.crt/client.key/ca.crt>" https://10.9.0.1:8443
# → ENGINE PROBE RESULT: { "status": "HEALTHY", "detail": "reachable — kamailio 6.1.5 ...", "contacted": true }
```
Or the opt-in integration test:
```bash
ENGINE_LIVE_MTLS_DIR="<dir>" corepack pnpm exec vitest run test/telecom-engine-live.e2e.test.ts
```
To wire the running API to the live engine, set in `apps/api/.env`:
`ENGINE_CONNECTOR=kamailio` and `ENGINE_MGMT_ALLOWLIST=10.9.0.1/32@8443`.

**Gotchas hit (save yourself the time):**
- `wg-quick save wg0` can DROP the `Address = 10.9.0.1/24` line → nginx
  `bind() to 10.9.0.1:8443 failed (99: Cannot assign requested address)`. Re-add:
  `ip addr add 10.9.0.1/24 dev wg0` and restore the line in `wg0.conf`.
- A stale apt index gives nginx `404 Not Found`; if `apt-get update` won't lock,
  a hung `apt-get update` may be holding it (`ps -o etime -p <pid>`) — kill it,
  clear `/var/lib/apt/lists/lock` + dpkg locks, `dpkg --configure -a`, re-update.
- A MITM antivirus on the control-plane host (e.g. AVG Web/Mail Shield) will
  intercept the TLS and present its own cert → `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.
  Disable its HTTPS scanning / add an exception. A real control-plane host has no
  such interception.
- Windows `curl` uses the schannel TLS backend and cannot load a PEM client cert
  (`schannel: Failed to import cert file`) — use Node (the connector) to test mTLS.

---

## Engine config apply — htable (Phase 12N-4b, ADR-0013) — OPERATOR-GATED

The real apply mutates ONLY the dedicated `telvyn` in-memory htable via JSONRPC.
It is off by default; the live mutation needs the VPS prerequisite + operator
confirmation.

**VPS prerequisite (one-time, on `vps-9345109a`):** declare the htable in the
management-only `kamailio.cfg`, then restart Kamailio:
```bash
# add near the other loadmodule lines:
#   loadmodule "htable.so"
# add near the other modparam lines:
#   modparam("htable", "htable", "telvyn=>size=8;")
grep -q 'htable.so' /etc/kamailio/kamailio.cfg || sed -i '/loadmodule "jsonrpcs.so"/a loadmodule "htable.so"' /etc/kamailio/kamailio.cfg
grep -q 'telvyn=>size' /etc/kamailio/kamailio.cfg || sed -i '/modparam("jsonrpcs"/a modparam("htable", "htable", "telvyn=>size=8;")' /etc/kamailio/kamailio.cfg
kamailio -c -f /etc/kamailio/kamailio.cfg && systemctl restart kamailio
# verify the table exists (empty dump is fine):
curl -s -X POST http://127.0.0.1:8000/RPC -d '{"jsonrpc":"2.0","method":"htable.dump","params":["telvyn"],"id":1}'
```

**Live apply test (opt-in, MUTATES the `telvyn` htable — disposable VPS only):**
after confirming identity/version/private path and the `telvyn` htable exists, and
with explicit operator go-ahead:
```bash
ENGINE_LIVE_MTLS_DIR="<dir with client.crt/client.key/ca.crt>" \
ENGINE_LIVE_ENDPOINT=https://10.9.0.1:8443 \
ENGINE_LIVE_ALLOWLIST=10.9.0.1/32@8443 \
corepack pnpm exec vitest run test/telecom-engine-apply-live.e2e.test.ts
```
It applies a small set, verifies, re-applies (idempotent 0-op), then rolls back to
empty. To wire the running API to real apply, set `ENGINE_CONNECTOR=kamailio` +
`ENGINE_MGMT_ALLOWLIST=10.9.0.1/32@8443` in `apps/api/.env`. Production DI stays
`NullEngineConnector` until that flag is set.

## Toll-fraud alerts (Phase 12R, SEC-002) — the alert → response path

Toll fraud is the #1 ranked risk (SEC-002). The fraud control plane records
fraud-relevant occurrences as append-only **`FraudEvent`** rows, read via
`GET /v1/fraud/events` (`fraud.events.read`; owner/admin/auditor), newest-first,
filterable by `type`/`severity`. Every alert carries `source` (the control),
`code` (machine reason), `severity`, an optional `correlationId` (the call
attempt), and bounded non-PII `metadata` (e.g. `destinationCountry`).

**Current wiring (as of 12R-7).** Two producers emit today:
- **`KILL_SWITCH`** — on every kill-switch activate/deactivate (12R-3). CRITICAL
  on activate, WARNING on deactivate.
- **`AUTHORIZATION_DENIED`** — `FraudAlertService` maps a denied toll-fraud
  decision to an alert (12R-7), throttled to one per `(tenant, code)` per 60s and
  **fail-open** (records even if the throttle store is down — a dropped alert is
  worse than a duplicate).

> **NOT YET LIVE:** nothing calls `FraudAlertService` at call time yet — the
> `/v1/fraud/authorize/preview` decision is a dry run and deliberately does **not**
> alert. Alerts begin flowing when the owner-gated call-authorization path (12R-8)
> is wired. `LIMIT_WARNING` (approaching a cap, pre-deny) has no producer yet.

**Severity → response.**

| Severity | Meaning | On-call response |
|---|---|---|
| CRITICAL | kill-switch active, or a usage store is down and calls are failing closed | Treat as an incident. Confirm scope (global vs one tenant), page the owner for a kill-switch; for a store outage see below. |
| WARNING | a policy breach denied a call (spend / velocity / geo-destination) | Triage: is it one tenant or many? Legitimate traffic growth, or a compromised account / unexpected destinations? |
| INFO | informational | Note; no immediate action. |

**By `code` (source → what it means → action).**

- `GLOBAL_KILL_SWITCH_ACTIVE` / `TENANT_KILL_SWITCH_ACTIVE` (`kill-switch`,
  CRITICAL) — all calling (platform-wide, or for one tenant) is halted. Expected
  during an active incident; if unexpected, find who toggled it
  (`fraud.kill_switch.*` AuditLog) and why.
- `COUNTERS_UNAVAILABLE` / `SPEND_RESERVATIONS_UNAVAILABLE` (`velocity` / `spend`,
  CRITICAL) — **Redis is unreachable**, so velocity / reserved-spend cannot be
  read and the decision is **failing closed** (denying calls for tenants that have
  those limits). This is an infrastructure incident, not fraud: restore Redis
  (check `REDIS_URL`, the host, and connectivity), confirm `GET /v1/fraud/events`
  stops emitting these, and verify calls recover. Do **not** disable the limits to
  "fix" it — that removes the fraud control.
- `PER_CALL_SPEND_EXCEEDED` / `DAILY_SPEND_EXCEEDED` / `MONTHLY_SPEND_EXCEEDED`
  (`spend`, WARNING) — the call's estimate (or the period's reserved spend) breached
  a tenant spend cap. Confirm the cap (`GET /v1/fraud/policies/spend-limits`) is
  intentional; a sudden spike in denials for one tenant suggests a compromised
  account or a dialer loop — consider the tenant kill-switch.
- `CALLS_PER_MINUTE_EXCEEDED` / `CALLS_PER_HOUR_EXCEEDED` / `CALLS_PER_DAY_EXCEEDED`
  / `CONCURRENT_CALLS_EXCEEDED` (`velocity`, WARNING) — a rate / concurrency cap was
  hit. Same triage: expected burst vs. abuse. Review the velocity limit
  (`GET /v1/fraud/policies/velocity-limits`).
- `COUNTRY_DENIED` / `PREFIX_DENIED` (`destination`, WARNING) — a call to a denied
  country / dial prefix. Repeated attempts to high-cost / premium destinations are a
  classic toll-fraud signature — check the account for compromise.
- `INVALID_DESTINATION` (`destination`, WARNING) — the dialled number did not
  normalize to E.164. Usually a client/data bug; a flood from one tenant can still
  indicate probing.

**Escalation.** A tenant kill-switch (`POST /v1/fraud/kill-switch/activate`,
`fraud.killswitch.manage`) halts one tenant's calling; the global switch
(`/v1/fraud/kill-switch/global/activate`, platform-admin) halts all of it. Both
are audited and emit a `KILL_SWITCH` event. Deactivate only once the cause is
understood.

## Fraud maintenance sweep (Phase 12R-9) — scheduled reconcile

Call authorization (12R-8) holds two resources per in-flight call: a spend
reservation and one concurrent-call gauge count. The call path returns both on
`POST /v1/fraud/authorize/complete` or `…/abandon`. When a call is authorized but
never finalized (a crash, or the engine never reports the end), those holds leak —
left alone, leaked concurrent counts would slowly wedge a tenant's concurrent-call
cap at the ceiling and deny good calls.

The sweep is the backstop. `POST /v1/fraud/maintenance/sweep` (platform-only,
`fraud.maintenance.run`) marks reservations past their TTL (6 h) as EXPIRED,
returns their spend hold, AND releases the matching concurrent-gauge count. It is
system-wide (all tenants), idempotent, and safe to run concurrently. Response:
`{ "expiredReservations": N, "concurrentReleased": N }`.

**Schedule it externally** — the service runs no in-process timer on purpose (one
would fire on every instance of the stateless, horizontally scaled API). Point an
ops cron / k8s CronJob at the endpoint every few minutes with a platform identity:

```bash
# every 5 minutes — adjust to call volume
*/5 * * * * curl -fsS -X POST https://api.portal.telvyn.co/v1/fraud/maintenance/sweep \
  -H "Authorization: Bearer $TELVYN_PLATFORM_TOKEN" >/dev/null
```

A sweep that repeatedly reports a high `concurrentReleased` means calls are being
authorized but not finalized — check the call path's complete/abandon reporting,
not the sweep.
