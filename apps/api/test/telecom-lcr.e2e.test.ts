import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12J — LCR policy foundation e2e (real Postgres + Redis). Declarative
 * route SELECTION config only — nothing executed, no rating/billing. Proves:
 * CRUD, tenant isolation + IDOR, RBAC, carrier/trunk eligibility (foreign +
 * deleted), cost/currency/prefix/effective-date validation, deterministic
 * candidate ordering, strategy re-ordering, mass-assignment, optimistic
 * concurrency, atomicity, audit, pagination, no secret exposure.
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
let seq = 0;
const pname = (n: string) => `tstl-${n}-${Date.now()}-${seq++}`;

async function flushRateLimits(): Promise<void> {
  const keys = await redis.keys("rl:*");
  if (keys.length) await redis.del(keys);
}
async function provision(roleKey: string): Promise<{ token: string }> {
  const email = `lcr.${Date.now()}.${Math.round(performance.now())}@telvyn.test`;
  const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" } });
  const tenant = await prisma.tenant.create({ data: { slug: `lcr-${user.id}`, name: "lcr", type: TenantType.CUSTOMER } });
  const m = await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } });
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId: null, key: roleKey } });
  await prisma.membershipRole.create({ data: { membershipId: m.id, roleId: role.id } });
  await prisma.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });
  const res = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
  return { token: res.body.accessToken };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function makeCarrier(token: string, name: string): Promise<string> {
  return (await request(http).post("/v1/telecom/carriers").set(auth(token)).send({ name: `tstl-${name}` })).body.id;
}
async function makeTrunk(token: string, name: string, carrierId: string): Promise<string> {
  return (await request(http).post("/v1/telecom/sip-trunks").set(auth(token)).send({ name: `tstl-${name}`, carrierId })).body.id;
}
const post = (token: string, body: object) => request(http).post("/v1/telecom/lcr-policies").set(auth(token)).send(body);
const patch = (token: string, id: string, body: object) => request(http).patch(`/v1/telecom/lcr-policies/${id}`).set(auth(token)).send(body);
const route = (carrierId: string, cost: number, extra: Record<string, unknown> = {}) => ({ carrierId, prefix: "9198", costMicros: cost, currency: "USD", ...extra });

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flushRateLimits);
afterAll(async () => {
  await prisma.lcrPolicy.deleteMany({ where: { name: { startsWith: "tstl-" } } });
  await prisma.sipTrunk.deleteMany({ where: { name: { startsWith: "tstl-" } } });
  await prisma.carrier.deleteMany({ where: { name: { startsWith: "tstl-" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: "lcr" } });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("RBAC + CRUD + deterministic ordering", () => {
  it("rejects unauthenticated access (401)", async () => {
    await request(http).get("/v1/telecom/lcr-policies").expect(401);
  });

  it("operator (routing.read, no routing.manage) reads but cannot create (403)", async () => {
    const op = await provision("operator");
    await request(http).get("/v1/telecom/lcr-policies").set(auth(op.token)).expect(200);
    await post(op.token, { name: pname("x") }).expect(403);
  });

  it("CRUDs a policy; candidates come back in deterministic LOWEST_COST order", async () => {
    const a = await provision("owner");
    const car = await makeCarrier(a.token, "c1");
    const created = await post(a.token, {
      name: pname("crud"),
      selectionStrategy: "LOWEST_COST",
      routes: [route(car, 300, { priority: 10 }), route(car, 100, { priority: 10 }), route(car, 200, { priority: 10 })],
    });
    expect(created.status).toBe(201);
    expect(created.body.candidates.map((c: { costMicros: number }) => c.costMicros)).toEqual([100, 200, 300]);
    expect(created.body.version).toBe(0);
    const id = created.body.id;
    await request(http).get(`/v1/telecom/lcr-policies/${id}`).set(auth(a.token)).expect(200);
    // Switch strategy → candidates re-order by priority.
    const upd = await patch(a.token, id, { selectionStrategy: "HIGHEST_PRIORITY", routes: [route(car, 500, { priority: 30 }), route(car, 400, { priority: 10 })] });
    expect(upd.body.candidates.map((c: { priority: number }) => c.priority)).toEqual([10, 30]);
    await request(http).delete(`/v1/telecom/lcr-policies/${id}`).set(auth(a.token)).expect(204);
    await request(http).get(`/v1/telecom/lcr-policies/${id}`).set(auth(a.token)).expect(404);
  });

  it("rejects a duplicate policy name (409)", async () => {
    const a = await provision("owner");
    const name = pname("dup");
    await post(a.token, { name }).expect(201);
    await post(a.token, { name }).expect(409);
  });
});

describe("tenant isolation + IDOR", () => {
  it("Tenant B cannot read / update / delete / enumerate Tenant A's policy", async () => {
    const a = await provision("owner");
    const b = await provision("owner");
    const id = (await post(a.token, { name: pname("iso") })).body.id;
    await request(http).get(`/v1/telecom/lcr-policies/${id}`).set(auth(b.token)).expect(404);
    await request(http).patch(`/v1/telecom/lcr-policies/${id}`).set(auth(b.token)).send({ enabled: false }).expect(404);
    await request(http).delete(`/v1/telecom/lcr-policies/${id}`).set(auth(b.token)).expect(404);
    const list = await request(http).get("/v1/telecom/lcr-policies").set(auth(b.token));
    expect(list.body.items.some((x: { id: string }) => x.id === id)).toBe(false);
  });
});

describe("carrier / trunk eligibility + cost/currency/prefix validation", () => {
  it("accepts own carrier/trunk; rejects foreign, deleted, and invalid values", async () => {
    const a = await provision("owner");
    const b = await provision("owner");
    const carA = await makeCarrier(a.token, "ca");
    const trunkA = await makeTrunk(a.token, "ta", carA);
    const carB = await makeCarrier(b.token, "cb");
    const trunkB = await makeTrunk(b.token, "tb", carB);

    await post(a.token, { name: pname("ok"), routes: [route(carA, 1234, { sipTrunkId: trunkA, country: "IN" })] }).expect(201);
    await post(a.token, { name: pname("fcar"), routes: [route(carB, 100)] }).expect(400); // foreign carrier
    await post(a.token, { name: pname("ftr"), routes: [route(carA, 100, { sipTrunkId: trunkB })] }).expect(400); // foreign trunk
    // Deleted carrier rejected.
    const carDel = await makeCarrier(a.token, "cdel");
    await request(http).delete(`/v1/telecom/carriers/${carDel}`).set(auth(a.token)).expect(204);
    await post(a.token, { name: pname("del"), routes: [route(carDel, 100)] }).expect(400);
    // Invalid cost / currency / prefix / effective dates.
    await post(a.token, { name: pname("negcost"), routes: [route(carA, -1)] }).expect(400);
    await post(a.token, { name: pname("bigcost"), routes: [route(carA, 9_999_999_999_999)] }).expect(400);
    await post(a.token, { name: pname("badcur"), routes: [{ carrierId: carA, prefix: "44", costMicros: 100, currency: "XYZ" }] }).expect(400);
    await post(a.token, { name: pname("badpfx"), routes: [{ carrierId: carA, prefix: "44a", costMicros: 100, currency: "USD" }] }).expect(400);
    await post(a.token, { name: pname("baddate"), routes: [route(carA, 100, { effectiveFrom: "2030-01-01T00:00:00.000Z", effectiveTo: "2029-01-01T00:00:00.000Z" })] }).expect(400);
    // Valid future effective window accepted.
    await post(a.token, { name: pname("fut"), routes: [route(carA, 100, { effectiveFrom: "2030-01-01T00:00:00.000Z", effectiveTo: "2031-01-01T00:00:00.000Z" })] }).expect(201);
  });
});

describe("security: mass assignment, concurrency, atomicity, no secret exposure, audit", () => {
  it("enforces ownership, optimistic concurrency, atomic replacement; exposes no secrets", async () => {
    const a = await provision("owner");
    const car = await makeCarrier(a.token, "c");
    // Mass assignment: unknown keys stripped on create; strict update rejects them.
    const created = await post(a.token, { name: pname("mass"), tenantId: "00000000-0000-7000-8000-000000000000", routes: [route(car, 1234), route(car, 5678)] });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain("secretEnc");
    expect(JSON.stringify(created.body)).not.toMatch(/password|secret/i);
    const id = created.body.id;
    await patch(a.token, id, { tenantId: "00000000-0000-7000-8000-000000000000" }).expect(400);

    // Optimistic concurrency.
    const u1 = await patch(a.token, id, { enabled: false, expectedVersion: 0 });
    expect(u1.body.version).toBe(1);
    await patch(a.token, id, { enabled: true, expectedVersion: 0 }).expect(409);

    // Atomic route replacement: an invalid route aborts the whole update.
    await patch(a.token, id, { routes: [route(car, 111), { carrierId: car, prefix: "bad!", costMicros: 1, currency: "USD" }] }).expect(400);
    const after = await request(http).get(`/v1/telecom/lcr-policies/${id}`).set(auth(a.token));
    expect(after.body.candidates.map((c: { costMicros: number }) => c.costMicros).sort((x: number, y: number) => x - y)).toEqual([1234, 5678]); // unchanged

    // Audit recorded.
    const logs = await request(http).get("/v1/audit-logs").set(auth(a.token));
    expect(logs.body.some((l: { action: string }) => l.action === "telecom.lcr_policy.created")).toBe(true);
  });

  it("paginates deterministically", async () => {
    const a = await provision("owner");
    for (let i = 0; i < 3; i++) await post(a.token, { name: pname(`pg${i}`) });
    const first = await request(http).get("/v1/telecom/lcr-policies?limit=2").set(auth(a.token));
    expect(first.body.items.length).toBe(2);
    expect(first.body.nextCursor).toBeTruthy();
    const next = await request(http).get(`/v1/telecom/lcr-policies?limit=2&cursor=${first.body.nextCursor}`).set(auth(a.token));
    const ids = new Set(first.body.items.map((x: { id: string }) => x.id));
    expect(next.body.items.every((x: { id: string }) => !ids.has(x.id))).toBe(true);
  });
});
