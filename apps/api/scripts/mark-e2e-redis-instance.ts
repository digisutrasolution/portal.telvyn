/**
 * INC-DB-001B — mark a DISPOSABLE Redis as an E2E test instance.
 *
 * Writes exactly ONE key (REDIS_MARKER_KEY) with the profile's marker value on
 * the profile's logical DB, which E2E Gate B requires. It first runs Gate A on
 * the explicitly supplied environment (the same validation the E2E lane uses),
 * so it refuses every protected port (5432/5433/6379/6380), any non-allowlisted
 * host/port/DB, and a missing/invalid profile — before opening a connection.
 * It never reads apps/api/.env, never scans, and never deletes anything.
 *
 * The isolated Redis is non-persistent: re-run after the container restarts
 * (Gate B fails closed until then).
 *
 *   TELVYN_E2E_PROFILE=local-isolated DATABASE_URL=... E2E_FIXTURE_DATABASE_URL=... \
 *   REDIS_URL=redis://127.0.0.1:6381 pnpm --filter @telvyn/api e2e:mark-redis
 */
import Redis from "ioredis";
import { REDIS_MARKER_KEY, validateGateA } from "../test/e2e-target-guard";

async function main(): Promise<void> {
  const a = validateGateA(process.env);
  const redis = new Redis(process.env.REDIS_URL as string, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try {
    await redis.connect();
    await redis.set(REDIS_MARKER_KEY, a.profile.redisMarker);
    console.info(`[e2e-marker] Redis marked for profile ${a.profile.name} (port ${a.redis.port}, db ${a.redis.db}).`);
  } finally {
    redis.disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "[e2e-marker] failed");
  process.exit(1);
});
