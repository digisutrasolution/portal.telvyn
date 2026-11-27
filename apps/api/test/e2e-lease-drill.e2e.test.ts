import "./e2e-guard"; // INC-DB-001B: two-stage target guard — must stay the FIRST import
/**
 * INC-DB-001B-PRE2 (N2) — live run-lease drill. SKIPPED unless BOTH hold:
 *   - the verified profile is `local-verify` (the dedicated disposable environment), and
 *   - TELVYN_E2E_LEASE_DRILL is "loss" or "setup-fail".
 * It never runs in `local-isolated` or `ci-ephemeral`.
 *
 *   loss        a long-running writer inserts run-prefixed Region rows (each stamped
 *               with the SERVER clock_timestamp()) and run-prefixed Redis keys
 *               (EX 3600) every 200 ms. The operator then terminates the lease session
 *               (application_name `telvyn-e2e-lease`) inside the disposable container;
 *               the worker fence must terminate this worker and the run must exit
 *               non-zero. The latest server timestamp vs. the termination timestamp
 *               bounds any post-loss mutation. If nothing stops the writer within
 *               120 s the test FAILS (the drill did not take effect).
 *   setup-fail  beforeAll throws; the run must exit non-zero and the global teardown
 *               must still release the lease.
 *
 * Rows/keys use the per-file run prefix only. On a normal finish they are removed by
 * that exact prefix; after a lease-loss termination they are intentionally left for
 * residue inspection (the worker is killed before any afterAll can run).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { E2E_TARGET } from "./e2e-guard";
import { fixturePrisma as prisma } from "./fixture-db";
import { runPrefix } from "./e2e-run";

const MODE = process.env.TELVYN_E2E_LEASE_DRILL;
const ENABLED = E2E_TARGET.profile.name === "local-verify" && (MODE === "loss" || MODE === "setup-fail");
const P = runPrefix("drill");

describe.skipIf(!ENABLED)(`run-lease drill (${MODE ?? "disabled"})`, () => {
  const redis = new Redis(process.env.REDIS_URL as string, { lazyConnect: true });
  let finished = false;

  beforeAll(async () => {
    if (MODE === "setup-fail") throw new Error("lease drill: intentional setup failure");
    await redis.connect();
  });

  afterAll(async () => {
    if (finished) {
      await prisma.region.deleteMany({ where: { code: { startsWith: P } } });
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `e2e:${P}*`, "COUNT", 100);
        cursor = next;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== "0");
    }
    await prisma.$disconnect();
    redis.disconnect();
  });

  it(
    "keeps mutating until the worker execution fence terminates it",
    async () => {
      const deadline = Date.now() + 120_000;
      let n = 0;
      console.info(`[lease-drill] writer started prefix=${P}`);
      while (Date.now() < deadline) {
        n += 1;
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Region" (code, name, country, timezone, "providerRegion", "updatedAt") VALUES ($1, 'lease drill', 'ZZ', 'UTC', clock_timestamp()::text, clock_timestamp())`,
          `${P}${n}`,
        );
        await redis.set(`e2e:${P}${n}`, new Date().toISOString(), "EX", 3600);
        await new Promise((r) => setTimeout(r, 200));
      }
      finished = true;
      expect.fail(`lease drill: writer was not terminated within 120 s (${n} mutations)`);
    },
    150_000,
  );
});
