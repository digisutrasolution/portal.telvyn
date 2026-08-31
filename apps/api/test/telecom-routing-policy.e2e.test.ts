/**
 * Phase 12I — Routing policy + failover foundation e2e (real Postgres + Redis).
 * Declarative config only. Proves: policy semantics, declarative failover
 * conditions, typed failover destinations, loop protection (self-failover +
 * bounded maxAttempts), bounded weight, atomic optimistic-concurrency updates,
 * and atomicity of rule replacement.
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
let seq = 0;
const pname = (n: string) => `tstp-${n}-${Date.now()}-${seq++}`;

async function flushRateLimits(): Promise<void> {
  const keys = await redis.keys("rl:*");
  if (keys.length) await redis.del(keys);
}
async function provision(): Promise<{ token: string }> {
  const email = `rpol.${Date.now()}.${Math.round(performance.now())}@telvyn.test`;
  const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" } });
  const tenant = await prisma.tenant.create({ data: { slug: `rpol-${user.id}`, name: "rpol", type: TenantType.CUSTOMER } });
  const m = await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } });
  const owner = await prisma.role.findFirstOrThrow({ where: { tenantId: null, key: "owner" } });
  await prisma.membershipRole.create({ data: { membershipId: m.id, roleId: owner.id } });
  await prisma.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });
  const res = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
  return { token: res.body.accessToken };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const post = (token: string, body: object) => request(http).post("/v1/telecom/routing-profiles").set(auth(token)).send(body);
const patch = (token: string, id: string, body: object) => request(http).patch(`/v1/telecom/routing-profiles/${id}`).set(auth(token)).send(body);

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flushRateLimits);
afterAll(async () => {
  await prisma.routingProfile.deleteMany({ where: { name: { startsWith: "tstp-" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: "rpol" } });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("routing policy semantics", () => {
  it("stores selection strategy, failover conditions, bounds, and typed failover", async () => {
    const a = await provision();
    const res = await post(a.token, {
      name: pname("policy"),
      selectionStrategy: "WEIGHTED",
      failoverEnabled: true,
      failoverConditions: ["NO_ANSWER", "BUSY"],
      maxAttempts: 5,
      overallTimeoutSeconds: 120,
      rules: [
        { destinationType: "EXTENSION", destination: "1001", priority: 10, weight: 70, failoverDestination: "2002", failoverDestinationType: "EXTENSION", failoverAfterSeconds: 20 },
        { destinationType: "EXTENSION", destination: "3003", priority: 20, weight: 30 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.policy.selectionStrategy).toBe("WEIGHTED");
    expect(res.body.policy.failoverConditions.sort()).toEqual(["BUSY", "NO_ANSWER"]);
    expect(res.body.policy.maxAttempts).toBe(5);
    expect(res.body.version).toBe(0);
    expect(res.body.rules[0].weight).toBe(70);
    expect(res.body.rules[0].failoverDestinationType).toBe("EXTENSION");
  });

  it("rejects failoverEnabled without conditions (400)", async () => {
    const a = await provision();
    await post(a.token, { name: pname("nofc"), failoverEnabled: true, failoverConditions: [] }).expect(400);
    await post(a.token, { name: pname("nofc2"), failoverEnabled: true }).expect(400);
  });

  it("rejects out-of-range policy/weight values", async () => {
    const a = await provision();
    await post(a.token, { name: pname("maxa"), maxAttempts: 99 }).expect(400);
    await post(a.token, { name: pname("wt"), rules: [{ destinationType: "EXTENSION", destination: "1", weight: 99999 }] }).expect(400);
    await post(a.token, { name: pname("oto"), overallTimeoutSeconds: 99999 }).expect(400);
  });
});

describe("failover typing + loop protection", () => {
  it("requires a failover type and rejects self-failover (incl. normalized phone numbers)", async () => {
    const a = await provision();
    // failoverDestination without type → 400
    await post(a.token, { name: pname("fnotype"), rules: [{ destinationType: "EXTENSION", destination: "1", failoverDestination: "2" }] }).expect(400);
    // self-loop (same type + same value) → 400
    await post(a.token, { name: pname("loop1"), rules: [{ destinationType: "EXTENSION", destination: "1001", failoverDestination: "1001", failoverDestinationType: "EXTENSION" }] }).expect(400);
    // self-loop across phone-number formats (normalized equal) → 400
    await post(a.token, { name: pname("loop2"), rules: [{ destinationType: "PHONE_NUMBER", destination: "+919876543210", failoverDestination: "+91 98765 43210", failoverDestinationType: "PHONE_NUMBER" }] }).expect(400);
    // a valid, non-looping typed failover → 201
    await post(a.token, { name: pname("okfo"), rules: [{ destinationType: "EXTENSION", destination: "1001", failoverDestination: "9999", failoverDestinationType: "EXTENSION" }] }).expect(201);
  });
});

describe("atomic optimistic-concurrency updates", () => {
  it("increments version and enforces expectedVersion (concurrent update loses → 409)", async () => {
    const a = await provision();
    const created = await post(a.token, { name: pname("conc"), rules: [{ destinationType: "EXTENSION", destination: "1000" }] });
    const id = created.body.id;
    expect(created.body.version).toBe(0);

    // Update with the correct expected version → succeeds, version → 1.
    const u1 = await patch(a.token, id, { status: "ACTIVE", expectedVersion: 0 });
    expect(u1.status).toBe(200);
    expect(u1.body.version).toBe(1);

    // A second update still holding version 0 → 409 (concurrent modification).
    await patch(a.token, id, { status: "SUSPENDED", expectedVersion: 0 }).expect(409);

    // Without expectedVersion → last-writer-wins, version keeps incrementing.
    const u2 = await patch(a.token, id, { description: "x" });
    expect(u2.body.version).toBe(2);
  });

  it("rule replacement is atomic — an invalid rule aborts the whole update", async () => {
    const a = await provision();
    const created = await post(a.token, { name: pname("atomic"), rules: [{ destinationType: "EXTENSION", destination: "1001" }, { destinationType: "EXTENSION", destination: "2002" }] });
    const id = created.body.id;
    expect(created.body.rules).toHaveLength(2);
    // Update with one valid + one invalid rule → 400, and the existing rules are untouched.
    await patch(a.token, id, { rules: [{ destinationType: "EXTENSION", destination: "3003" }, { destinationType: "PHONE_NUMBER", destination: "not-a-number" }] }).expect(400);
    const after = await request(http).get(`/v1/telecom/routing-profiles/${id}`).set(auth(a.token));
    expect(after.body.rules).toHaveLength(2); // unchanged — no partial write
    expect(after.body.rules.map((r: { destination: string }) => r.destination).sort()).toEqual(["1001", "2002"]);
  });
});
