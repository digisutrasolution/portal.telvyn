/**
 * Phase 12R-8 — Enforcing call-authorization e2e (real Postgres + Redis).
 * Proves the hook ENFORCES and commits real side effects: RBAC, ALLOW places a
 * reservation + advances the concurrent gauge, kill-switch DENY, a real
 * concurrent-cap breach (post-acquire) with compensation, idempotent retry, and
 * the complete/abandon lifecycle returning the held resources.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import * as argon2 from "argon2";
import Redis from "ioredis";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PrismaClient, TenantType } from "@prisma/client";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://telvyn:telvyn_dev@localhost:5432/telvyn?schema=public";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");

import { createApp } from "../src/main";
import { ARGON2_OPTIONS } from "../src/auth/account-flows.service";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL!);
let app: NestExpressApplication;
let http: ReturnType<NestExpressApplication["getHttpServer"]>;
const PASSWORD = "correct-horse-battery-staple-9";
const TRANSPORT = { "x-token-transport": "body" } as const;
const AUTHORIZE = "/v1/fraud/authorize";
const NAMES = ["cza", "czop"];

async function flush(): Promise<void> {
  for (const pat of ["rl:*", "fraud:*"]) {
    const keys = await redis.keys(pat);
    if (keys.length) await redis.del(...keys);
  }
}
async function systemRole(key: string): Promise<string> {
  return (await prisma.role.findFirstOrThrow({ where: { tenantId: null, key } })).id;
}
async function provision(tag: string, roleKey: string): Promise<{ token: string; tenantId: string }> {
  const email = `${tag}.${Date.now()}.${Math.round(performance.now())}@telvyn.test`;
  const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" } });
  const tenant = await prisma.tenant.create({ data: { slug: `${tag}-${user.id}`, name: tag, type: TenantType.CUSTOMER } });
  const membership = await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } });
  await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: await systemRole(roleKey) } });
  await prisma.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });
  const res = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
  return { token: res.body.accessToken, tenantId: tenant.id };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const conc = async (tenantId: string): Promise<number> => Number((await redis.get(`fraud:conc:${tenantId}`)) ?? 0);

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flush);
afterAll(async () => {
  await flush();
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: { in: NAMES } } }); // reservations + policies cascade
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("RBAC", () => {
  it("rejects unauthenticated (401)", async () => {
    await request(http).post(AUTHORIZE).send({ callKey: "k", destination: "+14155550123" }).expect(401);
  });
  it("forbids a caller without fraud.call.authorize (403)", async () => {
    const op = await provision("czop", "operator");
    await request(http).post(AUTHORIZE).set(auth(op.token)).send({ callKey: "k", destination: "+14155550123" }).expect(403);
  });
});

describe("enforcing commit", () => {
  it("ALLOWs a valid call, placing a reservation and advancing the concurrent gauge", async () => {
    const a = await provision("cza", "admin");
    const r = await request(http).post(AUTHORIZE).set(auth(a.token)).send({ callKey: "c-allow", destination: "+1 415 555 0123", estimatedCostMicros: 2500 }).expect(200);
    expect(r.body).toMatchObject({ decision: "ALLOW", callKey: "c-allow", destinationE164: "+14155550123" });
    expect(r.body.reservationId).toBeTruthy();
    const row = await prisma.spendReservation.findFirst({ where: { tenantId: a.tenantId, idempotencyKey: "c-allow" } });
    expect(row?.status).toBe("ACTIVE");
    expect(await conc(a.tenantId)).toBe(1);
  });

  it("DENYs everything when the tenant kill-switch is active — and takes no reservation", async () => {
    const a = await provision("cza", "admin");
    await request(http).post("/v1/fraud/kill-switch/activate").set(auth(a.token)).send({ reason: "test" }).expect(200);
    const r = await request(http).post(AUTHORIZE).set(auth(a.token)).send({ callKey: "c-ks", destination: "+14155550123" }).expect(200);
    expect(r.body.decision).toBe("DENY");
    expect(r.body.reasons[0].code).toBe("TENANT_KILL_SWITCH_ACTIVE");
    expect(r.body.callKey).toBeNull();
    expect(await prisma.spendReservation.findFirst({ where: { tenantId: a.tenantId, idempotencyKey: "c-ks" } })).toBeNull();
  });

  it("enforces a real CONCURRENT_CALLS cap: second simultaneous call is denied, gauge stays at the cap", async () => {
    const a = await provision("cza", "admin");
    await request(http).post("/v1/fraud/policies/velocity-limits").set(auth(a.token)).send({ metric: "CONCURRENT_CALLS", limit: 1 }).expect(201);
    const ok = await request(http).post(AUTHORIZE).set(auth(a.token)).send({ callKey: "c1", destination: "+14155550123" }).expect(200);
    expect(ok.body.decision).toBe("ALLOW");
    const denied = await request(http).post(AUTHORIZE).set(auth(a.token)).send({ callKey: "c2", destination: "+14155550123" }).expect(200);
    expect(denied.body.decision).toBe("DENY");
    expect(denied.body.reasons[0].code).toBe("CONCURRENT_CALLS_EXCEEDED");
    // c2 was compensated: the gauge is back at 1 (only c1 holds), and c2 took no hold.
    expect(await conc(a.tenantId)).toBe(1);
    expect(await prisma.spendReservation.findFirst({ where: { tenantId: a.tenantId, idempotencyKey: "c2", status: "ACTIVE" } })).toBeNull();
  });

  it("is idempotent — re-authorizing the same callKey returns the same hold, counted once", async () => {
    const a = await provision("cza", "admin");
    const r1 = await request(http).post(AUTHORIZE).set(auth(a.token)).send({ callKey: "dup", destination: "+14155550123", estimatedCostMicros: 1000 }).expect(200);
    const r2 = await request(http).post(AUTHORIZE).set(auth(a.token)).send({ callKey: "dup", destination: "+14155550123", estimatedCostMicros: 1000 }).expect(200);
    expect(r2.body.reservationId).toBe(r1.body.reservationId);
    expect(await prisma.spendReservation.count({ where: { tenantId: a.tenantId, idempotencyKey: "dup" } })).toBe(1);
    expect(await conc(a.tenantId)).toBe(1); // gauge advanced once, not twice
  });
});

describe("lifecycle", () => {
  it("completeCall settles the hold and releases the concurrent gauge", async () => {
    const a = await provision("cza", "admin");
    await request(http).post(AUTHORIZE).set(auth(a.token)).send({ callKey: "life", destination: "+14155550123", estimatedCostMicros: 1000 }).expect(200);
    expect(await conc(a.tenantId)).toBe(1);
    await request(http).post(`${AUTHORIZE}/complete`).set(auth(a.token)).send({ callKey: "life", actualCostMicros: 900 }).expect(204);
    expect(await conc(a.tenantId)).toBe(0);
    const row = await prisma.spendReservation.findFirst({ where: { tenantId: a.tenantId, idempotencyKey: "life" } });
    expect(row?.status).toBe("SETTLED");
    expect(Number(row?.settledMicros)).toBe(900);
  });

  it("abandonCall releases the hold and the gauge", async () => {
    const a = await provision("cza", "admin");
    await request(http).post(AUTHORIZE).set(auth(a.token)).send({ callKey: "gone", destination: "+14155550123" }).expect(200);
    await request(http).post(`${AUTHORIZE}/abandon`).set(auth(a.token)).send({ callKey: "gone" }).expect(204);
    expect(await conc(a.tenantId)).toBe(0);
    const row = await prisma.spendReservation.findFirst({ where: { tenantId: a.tenantId, idempotencyKey: "gone" } });
    expect(row?.status).toBe("RELEASED");
  });
});
