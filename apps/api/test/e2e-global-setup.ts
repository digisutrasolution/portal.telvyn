/**
 * Vitest globalSetup for the E2E lane — INC-DB-001B.
 *
 * Runs ONCE in the main process before any worker starts and before any E2E
 * test file is imported. Order is fixed:
 *   1. Gate A (pure, no socket) on the explicitly supplied environment.
 *   2. Only if Gate A passes: open read-only probe connections and run Gate B.
 *   3. Close every probe connection.
 *   4. Take the EXCLUSIVE run lease (M1, test/e2e-run-lease.ts): one E2E run per
 *      instance; a busy instance is refused before any test file runs.
 *      The lease is refused (INSTANCE_BUSY) while any test worker of an earlier
 *      run is still connected (N2 drain fence).
 *   5. Provide the credential-free target fingerprint, a run id and the lease
 *      session identity to workers (each worker joins the execution fence,
 *      test/e2e-worker-fence.ts, and terminates itself if the lease is lost).
 *   6. Global teardown releases the lease.
 * Any failure throws, and Vitest aborts the run before collecting test files,
 * so no fixture write and no cleanup can run against a rejected target.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { TestProject } from "vitest/node";
import {
  MIGRATION_STATE_SQL,
  PG_IDENTITY_SQL,
  REDIS_MARKER_KEY,
  type GateBProbes,
  type PgIdentityRow,
  validateGateA,
  verifyGateB,
} from "./e2e-target-guard";
import {
  FENCE_DRAIN_TRY_SQL,
  FENCE_DRAIN_UNLOCK_SQL,
  LEASE_HELD_SQL,
  LEASE_IDENTITY_SQL,
  LEASE_TRY_SQL,
  LEASE_UNLOCK_SQL,
  acquireRunLease,
  type LeaseDriver,
} from "./e2e-run-lease";

/** application_name of the main-process lease session (N2 drill targets it by name). */
export const LEASE_APPLICATION_NAME = "telvyn-e2e-lease";

declare module "vitest" {
  export interface ProvidedContext {
    telvynE2eFingerprint: string;
    telvynE2eRunId: string;
    /** Credential-free run-lease session identity (pid@backend_start) for the worker fence. */
    telvynE2eLease: string;
  }
}

function repositoryMigrations(): string[] {
  const dir = path.resolve(__dirname, "../prisma/migrations");
  return readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isDirectory());
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const gateA = validateGateA(process.env);

  // Gate A passed — only now are client libraries loaded and connections opened.
  const { PrismaClient } = await import("@prisma/client");
  const { default: Redis } = await import("ioredis");
  const appDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL as string } } });
  const fixDb = new PrismaClient({ datasources: { db: { url: process.env.E2E_FIXTURE_DATABASE_URL as string } } });
  const redis = new Redis(process.env.REDIS_URL as string, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });

  const identity = async (c: InstanceType<typeof PrismaClient>): Promise<PgIdentityRow> => {
    const rows = await c.$queryRawUnsafe<PgIdentityRow[]>(PG_IDENTITY_SQL);
    if (rows.length !== 1) throw new Error("identity row count");
    return rows[0];
  };
  const probes: GateBProbes = {
    appIdentity: () => identity(appDb),
    fixtureIdentity: () => identity(fixDb),
    migrationState: async () => {
      const rows = await fixDb.$queryRawUnsafe<{ name: string; ok: boolean }[]>(MIGRATION_STATE_SQL);
      return { applied: rows.filter((r) => r.ok).map((r) => r.name), unfinished: rows.filter((r) => !r.ok).length };
    },
    redisIdentity: async () => {
      await redis.connect();
      const info = String(await redis.call("CLIENT", "INFO"));
      const m = /\bdb=(\d+)\b/.exec(info);
      return { marker: await redis.get(REDIS_MARKER_KEY), db: m ? Number(m[1]) : -1 };
    },
  };

  try {
    const result = await verifyGateB(gateA, probes, repositoryMigrations());
    // Credential-free, non-secret summary.
    console.info(
      `[e2e-target-guard] Gate A+B passed: profile=${gateA.profile.name} db=${gateA.app.database} ` +
        `published-port=${gateA.app.port} server-port=${result.serverPort ?? "n/a"} migrations=${result.migrations}`,
    );
  } finally {
    await Promise.allSettled([appDb.$disconnect(), fixDb.$disconnect()]);
    redis.disconnect();
  }

  // M1 — exclusive run lease on ONE pinned session (connection_limit=1) of the
  // verified fixture target. The URL was validated by Gate A; only the pool size
  // is added here, which does not change the target.
  // N2: the session is named so it can be identified (and, in the disposable
  // local-verify drill only, terminated). Only pool size + name are added.
  const leaseUrl = new URL(process.env.E2E_FIXTURE_DATABASE_URL as string);
  leaseUrl.searchParams.set("connection_limit", "1");
  leaseUrl.searchParams.set("application_name", LEASE_APPLICATION_NAME);
  const leaseDb = new PrismaClient({ datasources: { db: { url: leaseUrl.toString() } } });
  const one = async (sql: string, col: string): Promise<boolean> =>
    Boolean((await leaseDb.$queryRawUnsafe<Record<string, boolean>[]>(sql))[0]?.[col]);
  const driver: LeaseDriver = {
    tryLock: () => one(LEASE_TRY_SQL, "ok"),
    stillHeld: () => one(LEASE_HELD_SQL, "held"),
    unlock: async () => {
      await one(LEASE_UNLOCK_SQL, "ok");
    },
    identity: async () => {
      const rows = await leaseDb.$queryRawUnsafe<{ pid: number; started: string }[]>(LEASE_IDENTITY_SQL);
      if (rows.length !== 1) throw new Error("lease identity row count");
      return { pid: Number(rows[0].pid), started: String(rows[0].started) };
    },
    drainTry: () => one(FENCE_DRAIN_TRY_SQL, "ok"),
    drainUnlock: async () => {
      await one(FENCE_DRAIN_UNLOCK_SQL, "ok");
    },
    close: () => leaseDb.$disconnect(),
  };
  const lease = await acquireRunLease(driver);
  console.info("[e2e-run-lease] exclusive run lease acquired; worker drain fence clear (one E2E run per instance).");

  project.provide("telvynE2eFingerprint", gateA.fingerprint);
  project.provide("telvynE2eRunId", `r${randomBytes(4).toString("hex")}`);
  project.provide("telvynE2eLease", lease.token);

  return async () => {
    await lease.release();
  };
}
