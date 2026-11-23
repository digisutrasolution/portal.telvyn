/**
 * Phase 12R-1 — Fraud-event foundation e2e (real Postgres + Redis). Proves:
 * RBAC (unauth 401, missing-permission 403, permitted 200), strict tenant
 * isolation (a tenant never sees another tenant's events), the safe view (no
 * tenant linkage echoed), and deterministic cursor pagination. There is NO
 * creation endpoint — events are inserted directly (the future internal
 * producers do not exist yet in this slice).
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
const CODE = "TST_FRAUD"; // all seeded events use this code → easy, targeted cleanup

async function flushRateLimits(): Promise<void> {
  const keys = await redis.keys("rl:*");
  if (keys.length) await redis.del(keys);
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
async function seedEvents(tenantId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await prisma.fraudEvent.create({
      data: { tenantId, type: "LIMIT_WARNING", severity: "WARNING", source: "velocity", code: CODE },
    });
  }
}

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flushRateLimits);
afterAll(async () => {
  await prisma.fraudEvent.deleteMany({ where: { code: CODE } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: { in: ["fa", "fb", "fop"] } } });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("RBAC", () => {
  it("rejects unauthenticated access (401)", async () => {
    await request(http).get("/v1/fraud/events").expect(401);
  });

  it("an operator (no fraud.events.read) is forbidden (403)", async () => {
    const op = await provision("fop", "operator");
    await request(http).get("/v1/fraud/events").set(auth(op.token)).expect(403);
  });

  it("an auditor (has fraud.events.read) can read (200)", async () => {
    const a = await provision("fa", "auditor");
    const res = await request(http).get("/v1/fraud/events").set(auth(a.token)).expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body).toHaveProperty("nextCursor");
  });
});

describe("tenant isolation + safe view", () => {
  it("returns only the caller's own events, never another tenant's, with no tenant linkage echoed", async () => {
    const a = await provision("fa", "auditor");
    const b = await provision("fb", "owner");
    await seedEvents(a.tenantId, 2);
    await seedEvents(b.tenantId, 2);

    const aRes = await request(http).get(`/v1/fraud/events?limit=100`).set(auth(a.token)).expect(200);
    const aOwn = aRes.body.items.filter((e: { code: string }) => e.code === CODE);
    expect(aOwn.length).toBe(2);
    // Safe view: never echoes the tenant linkage.
    expect(aOwn[0]).not.toHaveProperty("tenantId");
    expect(aOwn[0]).toMatchObject({ type: "LIMIT_WARNING", severity: "WARNING", source: "velocity" });

    // Tenant B sees its own 2 and none of A's.
    const bRes = await request(http).get(`/v1/fraud/events?limit=100`).set(auth(b.token)).expect(200);
    const bOwn = bRes.body.items.filter((e: { code: string }) => e.code === CODE);
    expect(bOwn.length).toBe(2);
    const aIds = new Set(aOwn.map((e: { id: string }) => e.id));
    expect(bOwn.every((e: { id: string }) => !aIds.has(e.id))).toBe(true);
  });
});

describe("pagination + filters", () => {
  it("paginates deterministically (no overlap) and honours the type filter", async () => {
    const a = await provision("fa", "auditor");
    await seedEvents(a.tenantId, 3);

    const first = await request(http).get("/v1/fraud/events?limit=2").set(auth(a.token)).expect(200);
    expect(first.body.items.length).toBe(2);
    expect(first.body.nextCursor).toBeTruthy();
    const next = await request(http).get(`/v1/fraud/events?limit=2&cursor=${first.body.nextCursor}`).set(auth(a.token)).expect(200);
    const firstIds = new Set(first.body.items.map((x: { id: string }) => x.id));
    expect(next.body.items.every((x: { id: string }) => !firstIds.has(x.id))).toBe(true);

    // A type that no seeded event has → empty.
    const none = await request(http).get("/v1/fraud/events?type=KILL_SWITCH&limit=100").set(auth(a.token)).expect(200);
    expect(none.body.items.filter((e: { code: string }) => e.code === CODE).length).toBe(0);
    // An invalid enum value → 400 (safe filtering).
    await request(http).get("/v1/fraud/events?type=NOPE").set(auth(a.token)).expect(400);
  });
});
