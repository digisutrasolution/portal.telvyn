import "./e2e-guard"; // INC-DB-001B: two-stage target guard — must stay the FIRST import
/**
 * INC-DB-001B — cleanup-scope regression (isolated, Gate-B-verified instance only).
 *
 * Seeds SENTINELS shaped exactly like the legacy fixtures that the old, broad
 * cleanup predicates used to match (an `@telvyn.test` user, tenants named
 * `alpha` / `ksa` with the legacy `<tag>-<userId>` slug, non-loopback and
 * non-run rate-limit keys, fraud counters of a non-run tenant, a GLOBAL kill
 * switch not toggled by this run) next to genuinely run-owned fixtures. It then
 * runs the SAME cleanup primitives the suites use and proves only the run-owned
 * rows/keys are removed. Sentinels are removed afterwards by exact id / key.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { randomBytes } from "node:crypto";
import { fixturePrisma as prisma } from "./fixture-db";
import {
  RUN_EMAIL_SUFFIX,
  clearFraudKeysFor,
  deleteRunGlobalKillSwitches,
  ownedTenantIds,
  ownedTenantWhere,
  ownedUserWhere,
  resetRunRateLimits,
  runPrefix,
} from "./e2e-run";

const redis = new Redis(process.env.REDIS_URL as string);
const nonce = randomBytes(4).toString("hex");
const S = {
  userId: "",
  tenantAlphaId: "",
  tenantKsaId: "",
  globalKillSwitchId: null as string | null,
  keys: [] as string[],
};
const OWN = { userId: "", tenantId: "", keys: [] as string[] };

beforeAll(async () => {
  // ---- sentinels (NOT owned by this run) ----
  const su = await prisma.user.create({ data: { email: `sentinel.${nonce}@telvyn.test`, passwordHash: "x", status: "ACTIVE" } });
  S.userId = su.id;
  S.tenantAlphaId = (await prisma.tenant.create({ data: { slug: `sentinel-alpha-${nonce}`, name: "alpha", type: "CUSTOMER" } })).id;
  S.tenantKsaId = (await prisma.tenant.create({ data: { slug: `ksa-${su.id}`, name: "ksa", type: "CUSTOMER" } })).id;
  if ((await prisma.killSwitch.count({ where: { scope: "GLOBAL" } })) === 0) {
    S.globalKillSwitchId = (await prisma.killSwitch.create({ data: { scope: "GLOBAL", active: false, deactivatedBy: su.id } })).id;
  }
  S.keys = [
    "rl:login-ip:203.0.113.7",
    `rl:login-email:sentinel.${nonce}@telvyn.test`,
    `fraud:conc:${S.tenantKsaId}`,
    `fraud:vel:${S.tenantKsaId}:CALLS_PER_MINUTE`,
    `fraud:spend:${S.tenantAlphaId}:DAILY`,
  ];
  for (const k of S.keys) await redis.set(k, "sentinel", "EX", 600);

  // ---- run-owned fixtures ----
  const ou = await prisma.user.create({ data: { email: `own.${nonce}${RUN_EMAIL_SUFFIX}`, passwordHash: "x", status: "ACTIVE" } });
  OWN.userId = ou.id;
  OWN.tenantId = (await prisma.tenant.create({ data: { slug: `ksa-${ou.id}`, name: "ksa", type: "CUSTOMER" } })).id;
  OWN.keys = [`rl:login-email:own.${nonce}${RUN_EMAIL_SUFFIX}`, "rl:login-ip:127.0.0.1", `fraud:conc:${OWN.tenantId}`];
  for (const k of OWN.keys) await redis.set(k, "owned", "EX", 600);
});

afterAll(async () => {
  // Sentinels: exact keys / ids only.
  await redis.del(...S.keys, ...OWN.keys);
  if (S.globalKillSwitchId) await prisma.killSwitch.deleteMany({ where: { id: S.globalKillSwitchId } });
  await prisma.tenant.deleteMany({ where: { id: { in: [S.tenantAlphaId, S.tenantKsaId, OWN.tenantId].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [S.userId, OWN.userId].filter(Boolean) } } });
  await prisma.$disconnect();
  await redis.quit();
});

describe("run-scoped cleanup removes only run-owned data", () => {
  it("leaves legacy-shaped sentinels intact while removing this run's fixtures", async () => {
    const ownedTenants = await ownedTenantWhere(prisma, ["alpha", "ksa"]);
    expect(await ownedTenantIds(prisma, ["alpha", "ksa"])).toEqual([OWN.tenantId]);

    await deleteRunGlobalKillSwitches(prisma, []);
    await clearFraudKeysFor(redis, await ownedTenantIds(prisma, ["alpha", "ksa"]));
    await resetRunRateLimits(redis);
    await prisma.user.deleteMany({ where: ownedUserWhere() });
    await prisma.tenant.deleteMany({ where: ownedTenants });

    // Run-owned → gone.
    expect(await prisma.user.count({ where: { id: OWN.userId } })).toBe(0);
    expect(await prisma.tenant.count({ where: { id: OWN.tenantId } })).toBe(0);
    for (const k of OWN.keys) expect(await redis.exists(k)).toBe(0);

    // Sentinels → untouched.
    expect(await prisma.user.count({ where: { id: S.userId } })).toBe(1);
    expect(await prisma.tenant.count({ where: { id: { in: [S.tenantAlphaId, S.tenantKsaId] } } })).toBe(2);
    if (S.globalKillSwitchId) expect(await prisma.killSwitch.count({ where: { id: S.globalKillSwitchId } })).toBe(1);
    for (const k of S.keys) expect(await redis.get(k)).toBe("sentinel");
  });

  it("refuses an unscoped SCAN pattern and produces run-scoped prefixes", async () => {
    const { scanKeys } = await import("./e2e-run");
    await expect(scanKeys(redis, "*")).rejects.toThrow(/unscoped/);
    expect(runPrefix("tstc")).toMatch(/^tstc-r[0-9a-f]{8}[0-9a-z]*-$/);
  });
});
