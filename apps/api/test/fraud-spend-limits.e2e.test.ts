import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12R-2a — Spend-limit authoring e2e (real Postgres + Redis). Proves:
 * RBAC (read vs manage), CRUD roundtrip, one-active-limit-per-period (409),
 * optimistic concurrency (409), tenant isolation + IDOR, and integer-micros
 * money precision. DECLARATIVE config only — nothing is enforced.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
const BASE = "/v1/fraud/policies/spend-limits";
const NAMES = ["sla", "slb", "slaud"];

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

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flushRateLimits);
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: { in: NAMES } } }); // spend limits cascade on tenant delete
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("RBAC", () => {
  it("rejects unauthenticated access (401)", async () => {
    await request(http).get(BASE).expect(401);
  });

  it("an auditor (fraud.policy.read, no manage) can read but not write (403)", async () => {
    const aud = await provision("slaud", "auditor");
    await request(http).get(BASE).set(auth(aud.token)).expect(200);
    await request(http).post(BASE).set(auth(aud.token)).send({ period: "DAILY", amountMicros: 1_000_000 }).expect(403);
  });
});

describe("CRUD + money + concurrency", () => {
  it("creates, reads, updates (version bumps) and soft-deletes a spend limit; money is integer micros", async () => {
    const a = await provision("sla", "admin");
    const created = await request(http).post(BASE).set(auth(a.token)).send({ period: "MONTHLY", amountMicros: 250_000_000 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ period: "MONTHLY", amountMicros: 250_000_000, currency: "USD", enabled: true, version: 1 });
    const id = created.body.id as string;

    await request(http).get(`${BASE}/${id}`).set(auth(a.token)).expect(200);

    const upd = await request(http).patch(`${BASE}/${id}`).set(auth(a.token)).send({ amountMicros: 500_000_000, expectedVersion: 1 });
    expect(upd.status).toBe(200);
    expect(upd.body.amountMicros).toBe(500_000_000);
    expect(upd.body.version).toBe(2);

    // Stale expectedVersion → 409.
    await request(http).patch(`${BASE}/${id}`).set(auth(a.token)).send({ amountMicros: 1, expectedVersion: 1 }).expect(409);

    await request(http).delete(`${BASE}/${id}`).set(auth(a.token)).expect(204);
    await request(http).get(`${BASE}/${id}`).set(auth(a.token)).expect(404);
  });

  it("allows at most one active limit per period (duplicate → 409)", async () => {
    const a = await provision("sla", "admin");
    await request(http).post(BASE).set(auth(a.token)).send({ period: "DAILY", amountMicros: 10_000_000 }).expect(201);
    await request(http).post(BASE).set(auth(a.token)).send({ period: "DAILY", amountMicros: 20_000_000 }).expect(409);
  });

  it("rejects invalid input (negative / float amount, bad period, non-uuid id)", async () => {
    const a = await provision("sla", "admin");
    await request(http).post(BASE).set(auth(a.token)).send({ period: "DAILY", amountMicros: -5 }).expect(400);
    await request(http).post(BASE).set(auth(a.token)).send({ period: "DAILY", amountMicros: 1.5 }).expect(400);
    await request(http).post(BASE).set(auth(a.token)).send({ period: "NOPE", amountMicros: 1 }).expect(400);
    await request(http).get(`${BASE}/not-a-uuid`).set(auth(a.token)).expect(400);
  });
});

describe("tenant isolation + IDOR", () => {
  it("Tenant B cannot read / update / delete / enumerate Tenant A's limit", async () => {
    const a = await provision("sla", "admin");
    const b = await provision("slb", "admin");
    const created = await request(http).post(BASE).set(auth(a.token)).send({ period: "PER_CALL", amountMicros: 2_000_000 }).expect(201);
    const id = created.body.id as string;

    await request(http).get(`${BASE}/${id}`).set(auth(b.token)).expect(404);
    await request(http).patch(`${BASE}/${id}`).set(auth(b.token)).send({ enabled: false }).expect(404);
    await request(http).delete(`${BASE}/${id}`).set(auth(b.token)).expect(404);
    const bList = await request(http).get(`${BASE}?limit=100`).set(auth(b.token)).expect(200);
    expect(bList.body.items.some((x: { id: string }) => x.id === id)).toBe(false);
    // A's limit is untouched.
    expect((await request(http).get(`${BASE}/${id}`).set(auth(a.token))).status).toBe(200);
  });
});
