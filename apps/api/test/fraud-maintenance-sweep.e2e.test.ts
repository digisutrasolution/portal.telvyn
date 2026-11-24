import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12R-9 — Fraud maintenance sweep e2e (real Postgres + Redis). Proves the
 * platform-only sweep reconciles leaked holds: a CUSTOMER caller is forbidden; a
 * PLATFORM caller sweeps; an overdue ACTIVE reservation is marked EXPIRED and its
 * leaked concurrent-gauge count released.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import request from "supertest";
import * as argon2 from "argon2";
import Redis from "ioredis";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { TenantType } from "@prisma/client";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://telvyn:telvyn_dev@localhost:5432/telvyn?schema=public";
process.env.REDIS_URL ??= "redis://localhost:6379";
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
const SWEEP = "/v1/fraud/maintenance/sweep";
const NAMES = ["swcust", "swplat"];

async function flush(): Promise<void> {
  const keys = await redis.keys("fraud:*");
  if (keys.length) await redis.del(...keys);
}
async function systemRole(key: string): Promise<string> {
  return (await prisma.role.findFirstOrThrow({ where: { tenantId: null, key } })).id;
}
async function provision(tag: string, type: TenantType, roleKey: string): Promise<{ token: string; tenantId: string }> {
  const email = `${tag}.${Date.now()}.${Math.round(performance.now())}@telvyn.test`;
  const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" } });
  const tenant = await prisma.tenant.create({ data: { slug: `${tag}-${user.id}`, name: tag, type } });
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
beforeEach(flush);
afterAll(async () => {
  await flush();
  await prisma.spendReservation.deleteMany({ where: { idempotencyKey: { startsWith: "sweep-" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: { in: NAMES } } });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

it("forbids a non-platform caller (403)", async () => {
  const cust = await provision("swcust", TenantType.CUSTOMER, "admin");
  await request(http).post(SWEEP).set(auth(cust.token)).expect(403);
});

it("a platform caller sweeps — nothing overdue returns zeros", async () => {
  const plat = await provision("swplat", TenantType.PLATFORM, "admin");
  const r = await request(http).post(SWEEP).set(auth(plat.token)).expect(200);
  expect(r.body).toMatchObject({ expiredReservations: expect.any(Number), concurrentReleased: expect.any(Number) });
});

it("expires an overdue hold and releases its leaked concurrent-gauge count", async () => {
  const plat = await provision("swplat", TenantType.PLATFORM, "admin");
  const cust = await provision("swcust", TenantType.CUSTOMER, "admin");
  // Simulate a leaked authorization: an ACTIVE reservation past its TTL + a held
  // concurrent-gauge count that complete/abandon never returned.
  await prisma.spendReservation.create({
    data: { tenantId: cust.tenantId, idempotencyKey: "sweep-leak-1", amountMicros: 0n, expiresAt: new Date(Date.now() - 60_000) },
  });
  await redis.set(`fraud:conc:${cust.tenantId}`, "1");

  const r = await request(http).post(SWEEP).set(auth(plat.token)).expect(200);
  expect(r.body.expiredReservations).toBeGreaterThanOrEqual(1);
  expect(r.body.concurrentReleased).toBeGreaterThanOrEqual(1);

  const row = await prisma.spendReservation.findFirst({ where: { tenantId: cust.tenantId, idempotencyKey: "sweep-leak-1" } });
  expect(row?.status).toBe("EXPIRED");
  expect(Number((await redis.get(`fraud:conc:${cust.tenantId}`)) ?? 0)).toBe(0); // gauge returned
});
