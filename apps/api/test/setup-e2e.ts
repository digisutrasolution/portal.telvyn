/**
 * Fail-closed E2E target guard (Slice 13-1A.4b).
 *
 * The E2E suite must connect ONLY to an isolated, disposable, non-production
 * data plane. This runs before any E2E file and throws — aborting the suite —
 * unless the targets are explicitly set and isolated. It neutralizes the legacy
 * `process.env.X ??= "...shared dev..."` fallbacks (ports 5432/5433, Redis
 * 6379/6380) by requiring the vars to be set and refusing shared targets.
 *
 * Local (default): DATABASE_URL must be the disposable telvyn_ledger_e2e on
 * 127.0.0.1:5434, REDIS_URL the isolated Redis on 127.0.0.1:6381.
 * CI: set TELVYN_E2E_ALLOW_TARGET=1 to use a CI-managed isolated data plane;
 * both URLs are still required, and the shared dev ports remain refused.
 */
const DB = process.env.DATABASE_URL;
const REDIS = process.env.REDIS_URL;

function fail(msg: string): never {
  throw new Error(`[e2e-target-guard] ${msg}`);
}

if (!DB) fail("DATABASE_URL must be explicitly set for E2E — no shared-DB fallback is permitted.");
if (!REDIS) fail("REDIS_URL must be explicitly set for E2E — no shared-Redis fallback is permitted.");

// Shared dev/other-project ports are refused in every mode.
if (/:5432(\/|\b)/.test(DB) || /:5433(\/|\b)/.test(DB)) {
  fail(`DATABASE_URL targets a shared dev PostgreSQL port (5432/5433); refusing.`);
}
if (/:6379(\/|\b)/.test(REDIS) || /:6380(\/|\b)/.test(REDIS)) {
  fail(`REDIS_URL targets a shared Redis port (6379/6380); refusing.`);
}

const ciAllowed = process.env.TELVYN_E2E_ALLOW_TARGET === "1";
if (!ciAllowed) {
  if (!/@127\.0\.0\.1:5434\//.test(DB) || !/\/telvyn_ledger_e2e(\?|$)/.test(DB)) {
    fail("DATABASE_URL must target the disposable telvyn_ledger_e2e database on 127.0.0.1:5434 (or set TELVYN_E2E_ALLOW_TARGET=1 for a CI-isolated instance).");
  }
  if (!/@?127\.0\.0\.1:6381(\/|\b)/.test(REDIS)) {
    fail("REDIS_URL must target the isolated Redis on 127.0.0.1:6381 (or set TELVYN_E2E_ALLOW_TARGET=1 for a CI-isolated instance).");
  }
}

// The privileged fixture connection (setup/teardown) must also be isolated.
const FIX = process.env.E2E_FIXTURE_DATABASE_URL;
if (FIX) {
  if (/:5432(\/|\b)/.test(FIX) || /:5433(\/|\b)/.test(FIX)) {
    fail("E2E_FIXTURE_DATABASE_URL targets a shared dev PostgreSQL port (5432/5433); refusing.");
  }
  if (!ciAllowed && (!/@127\.0\.0\.1:5434\//.test(FIX) || !/\/telvyn_ledger_e2e(\?|$)/.test(FIX))) {
    fail("E2E_FIXTURE_DATABASE_URL must target the disposable telvyn_ledger_e2e database on 127.0.0.1:5434.");
  }
}
