import "./e2e-guard"; // INC-DB-001B: two-stage target guard — must stay the FIRST import
import { RUN_EMAIL_SUFFIX, clearFraudKeysFor, ownedTenantIds, ownedTenantWhere, ownedUserWhere, resetRunRateLimits } from "./e2e-run";
import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12R-4/5/6 — Authorization-decision preview e2e (real Postgres + Redis).
 * Proves the dry-run preview consumes the tenant's real policies + kill-switch +
 * live usage: RBAC, ALLOW with no policy, destination DENY, per-call spend DENY,
 * kill-switch DENY, invalid-destination DENY, a live velocity counter DENY, and
 * a reserved-spend (ledger) DENY. Read-only — nothing is enforced or placed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import * as argon2 from "argon2";
import Redis from "ioredis";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { TenantType } from "@prisma/client";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");

import { createApp } from "../src/main";
import { ARGON2_OPTIONS } from "../src/auth/account-flows.service";

const prisma = fixturePrisma;
const redis = new Redis(process.env.REDIS_URL!);
let app: NestExpressApplication;
let http: ReturnType<NestExpressApplication["getHttpServer"]>;
const PASSWORD = "correct-horse-battery-staple-9";
const TRANSPORT = { "x-token-transport": "body" } as const;
const PREVIEW = "/v1/fraud/authorize/preview";
const NAMES = ["aza", "azop"];

async function flushRateLimits(): Promise<void> {
  await resetRunRateLimits(redis);
}
async function systemRole(key: string): Promise<string> {
  return (await prisma.role.findFirstOrThrow({ where: { tenantId: null, key } })).id;
}
async function provision(tag: string, roleKey: string): Promise<{ token: string; tenantId: string }> {
  const email = `${tag}.${Date.now()}.${Math.round(performance.now())}${RUN_EMAIL_SUFFIX}`;
  const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" } });
  const tenant = await prisma.tenant.create({ data: { slug: `${tag}-${user.id}`, name: tag, type: TenantType.CUSTOMER } });
  const membership = await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } });
  await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: await systemRole(roleKey) } });
  await prisma.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });
  const res = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
  return { token: res.body.accessToken, tenantId: tenant.id };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flushRateLimits);
afterAll(async () => {
  // Resolve run-owned tenants BEFORE their owning users are deleted.
  const ownedTenants = await ownedTenantWhere(prisma, NAMES);
  // Velocity / concurrency / spend counters of run-owned tenants only (SCAN, never KEYS).
  await clearFraudKeysFor(redis, await ownedTenantIds(prisma, NAMES));
  await prisma.user.deleteMany({ where: ownedUserWhere() });
  await prisma.tenant.deleteMany({ where: ownedTenants }); // policies + reservations + tenant kill-switch cascade
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("RBAC + baseline", () => {
  it("rejects unauthenticated access (401)", async () => {
    await request(http).post(PREVIEW).send({ destination: "+14155550123" }).expect(401);
  });

  it("an operator without fraud.policy.read is forbidden (403)", async () => {
    const op = await provision("azop", "operator");
    await request(http).post(PREVIEW).set(auth(op.token)).send({ destination: "+14155550123" }).expect(403);
  });

  it("ALLOWs a valid call when the tenant has no policy", async () => {
    const a = await provision("aza", "admin");
    const r = await request(http).post(PREVIEW).set(auth(a.token)).send({ destination: "+1 415 555 0123", estimatedCostMicros: 1000 }).expect(200);
    expect(r.body).toMatchObject({ decision: "ALLOW", destinationE164: "+14155550123", destinationCountry: "US" });
    expect(r.body.reasons).toEqual([]);
  });

  it("DENYs an unparseable destination", async () => {
    const a = await provision("aza", "admin");
    const r = await request(http).post(PREVIEW).set(auth(a.token)).send({ destination: "nope" }).expect(200);
    expect(r.body.decision).toBe("DENY");
    expect(r.body.reasons[0].code).toBe("INVALID_DESTINATION");
  });
});

describe("consumes real policies + kill-switch", () => {
  it("DENYs a destination denied by a geo rule", async () => {
    const a = await provision("aza", "admin");
    await request(http).post("/v1/fraud/policies/destination-rules").set(auth(a.token)).send({ matchType: "COUNTRY", matchValue: "US", action: "DENY" }).expect(201);
    const r = await request(http).post(PREVIEW).set(auth(a.token)).send({ destination: "+14155550123" }).expect(200);
    expect(r.body.decision).toBe("DENY");
    expect(r.body.reasons[0]).toMatchObject({ control: "destination", code: "COUNTRY_DENIED" });
  });

  it("DENYs when the estimate exceeds the per-call spend cap", async () => {
    const a = await provision("aza", "admin");
    await request(http).post("/v1/fraud/policies/spend-limits").set(auth(a.token)).send({ period: "PER_CALL", amountMicros: 1000 }).expect(201);
    const r = await request(http).post(PREVIEW).set(auth(a.token)).send({ destination: "+14155550123", estimatedCostMicros: 5000 }).expect(200);
    expect(r.body.decision).toBe("DENY");
    expect(r.body.reasons[0].code).toBe("PER_CALL_SPEND_EXCEEDED");
  });

  it("DENYs everything when the tenant kill-switch is active", async () => {
    const a = await provision("aza", "admin");
    await request(http).post("/v1/fraud/kill-switch/activate").set(auth(a.token)).send({ reason: "test" }).expect(200);
    const r = await request(http).post(PREVIEW).set(auth(a.token)).send({ destination: "+14155550123" }).expect(200);
    expect(r.body.decision).toBe("DENY");
    expect(r.body.reasons[0].code).toBe("TENANT_KILL_SWITCH_ACTIVE");
  });

  it("DENYs when the live velocity counter is already at the configured limit", async () => {
    const a = await provision("aza", "admin");
    // Seed the live per-minute counter directly (the real call path that would
    // increment it is a later slice); the preview must read it.
    await redis.set(`fraud:vel:${a.tenantId}:CALLS_PER_MINUTE`, "5");
    await request(http).post("/v1/fraud/policies/velocity-limits").set(auth(a.token)).send({ metric: "CALLS_PER_MINUTE", limit: 5 }).expect(201);
    const r = await request(http).post(PREVIEW).set(auth(a.token)).send({ destination: "+14155550123" }).expect(200);
    expect(r.body.decision).toBe("DENY");
    expect(r.body.reasons[0].code).toBe("CALLS_PER_MINUTE_EXCEEDED");
  });

  it("DENYs when the reserved period spend already exceeds the cap", async () => {
    const a = await provision("aza", "admin");
    // Seed the live per-day reserved gauge directly (the real call path that
    // would place reservations is a later slice); the preview must read it.
    await redis.set(`fraud:spend:${a.tenantId}:DAILY`, "5000");
    await request(http).post("/v1/fraud/policies/spend-limits").set(auth(a.token)).send({ period: "DAILY", amountMicros: 1000 }).expect(201);
    const r = await request(http).post(PREVIEW).set(auth(a.token)).send({ destination: "+14155550123" }).expect(200);
    expect(r.body.decision).toBe("DENY");
    expect(r.body.reasons[0].code).toBe("DAILY_SPEND_EXCEEDED");
  });
});
