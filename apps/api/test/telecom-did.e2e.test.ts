import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12G — DID foundation e2e (real Postgres + Redis). Proves: CRUD, tenant
 * isolation + IDOR (auto-scoped), E.164 normalization + global-unique duplicate
 * rejection, relationship authorization (carrier/trunk/routing-profile/region),
 * carrier↔trunk consistency, deleted-relation handling, RBAC, mass-assignment
 * protection, pagination, audit, honest health.
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

let didSeq = 0;
/** Unique, VALID Indian mobile (+91 98xxxxxxxx) per call — avoids global-unique collisions. */
function uniqueNumber(): string {
  didSeq += 1;
  const suffix = (Date.now() * 100 + didSeq) % 100_000_000;
  return "+9198" + String(suffix).padStart(8, "0");
}

async function flushRateLimits(): Promise<void> {
  const keys = await redis.keys("rl:*");
  if (keys.length) await redis.del(keys);
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
async function makeCarrier(token: string, name: string): Promise<string> {
  return (await request(http).post("/v1/telecom/carriers").set(auth(token)).send({ name: `tstd-${name}` })).body.id;
}
async function makeTrunk(token: string, name: string, carrierId: string): Promise<string> {
  return (await request(http).post("/v1/telecom/sip-trunks").set(auth(token)).send({ name: `tstd-${name}`, carrierId })).body.id;
}
async function makeProfile(tenantId: string, name: string): Promise<string> {
  return (await prisma.routingProfile.create({ data: { tenantId, name: `tstd-${name}-${Date.now()}` } })).id;
}

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flushRateLimits);
afterAll(async () => {
  await prisma.did.deleteMany({ where: { tenant: { name: { in: ["da", "db", "dop"] } } } });
  await prisma.sipTrunk.deleteMany({ where: { name: { startsWith: "tstd-" } } });
  await prisma.carrier.deleteMany({ where: { name: { startsWith: "tstd-" } } });
  await prisma.routingProfile.deleteMany({ where: { name: { startsWith: "tstd-" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: { in: ["da", "db", "dop"] } } });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("RBAC + CRUD + normalization", () => {
  it("rejects unauthenticated access (401)", async () => {
    await request(http).get("/v1/telecom/dids").expect(401);
  });

  it("operator (did.read, no did.manage) reads but cannot create (403)", async () => {
    const op = await provision("dop", TenantType.CUSTOMER, "operator");
    await request(http).get("/v1/telecom/dids").set(auth(op.token)).expect(200);
    await request(http).post("/v1/telecom/dids").set(auth(op.token)).send({ number: uniqueNumber() }).expect(403);
  });

  it("owner creates (E.164-normalized), reads, updates, soft-deletes a DID", async () => {
    const a = await provision("da", TenantType.CUSTOMER, "owner");
    const created = await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: "+91 98765 43210" });
    expect(created.status).toBe(201);
    expect(created.body.e164).toBe("+919876543210"); // canonical
    expect(created.body.country).toBe("IN"); // derived
    const id = created.body.id;
    await request(http).get(`/v1/telecom/dids/${id}`).set(auth(a.token)).expect(200);
    const upd = await request(http).patch(`/v1/telecom/dids/${id}`).set(auth(a.token)).send({ status: "ACTIVE" });
    expect(upd.body.status).toBe("ACTIVE");
    await request(http).delete(`/v1/telecom/dids/${id}`).set(auth(a.token)).expect(204);
    await request(http).get(`/v1/telecom/dids/${id}`).set(auth(a.token)).expect(404);
  });

  it("rejects invalid numbers and enforces global-unique (incl. alternate formatting)", async () => {
    const a = await provision("da", TenantType.CUSTOMER, "owner");
    await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: "hello" }).expect(400);
    await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: "919876543210" }).expect(400); // no +
    const num = uniqueNumber();
    await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: num }).expect(201);
    // Same number in a different format → normalizes to the same canonical → duplicate (409).
    const spaced = num.replace("+9198", "+91 98 ");
    await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: spaced }).expect(409);
    // A different tenant also cannot claim the same physical number (global unique).
    const b = await provision("db", TenantType.CUSTOMER, "owner");
    await request(http).post("/v1/telecom/dids").set(auth(b.token)).send({ number: num }).expect(409);
  });
});

describe("tenant isolation + IDOR", () => {
  it("Tenant B cannot read / update / delete / enumerate Tenant A's DID", async () => {
    const a = await provision("da", TenantType.CUSTOMER, "owner");
    const b = await provision("db", TenantType.CUSTOMER, "owner");
    const id = (await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: uniqueNumber() })).body.id;
    await request(http).get(`/v1/telecom/dids/${id}`).set(auth(b.token)).expect(404);
    await request(http).patch(`/v1/telecom/dids/${id}`).set(auth(b.token)).send({ status: "ACTIVE" }).expect(404);
    await request(http).delete(`/v1/telecom/dids/${id}`).set(auth(b.token)).expect(404);
    const list = await request(http).get("/v1/telecom/dids").set(auth(b.token));
    expect(list.body.items.some((x: { id: string }) => x.id === id)).toBe(false);
  });
});

describe("relationship authorization + consistency", () => {
  it("validates carrier / trunk / routing-profile / region and rejects foreign, deleted, and mismatched", async () => {
    const a = await provision("da", TenantType.CUSTOMER, "owner");
    const b = await provision("db", TenantType.CUSTOMER, "owner");
    const carA = await makeCarrier(a.token, "ca");
    const trunkA = await makeTrunk(a.token, "ta", carA);
    const profA = await makeProfile(a.tenantId, "pa");
    const carA2 = await makeCarrier(a.token, "ca2");
    const carB = await makeCarrier(b.token, "cb");
    const trunkB = await makeTrunk(b.token, "tb", carB);
    const profB = await makeProfile(b.tenantId, "pb");

    // Valid: own carrier + own trunk (belongs to that carrier) + own profile.
    await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: uniqueNumber(), carrierId: carA, sipTrunkId: trunkA, routingProfileId: profA }).expect(201);
    // Foreign carrier / trunk / profile → 400.
    await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: uniqueNumber(), carrierId: carB }).expect(400);
    await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: uniqueNumber(), sipTrunkId: trunkB }).expect(400);
    await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: uniqueNumber(), routingProfileId: profB }).expect(400);
    // Carrier/trunk mismatch (carrier A2, trunk belongs to A) → 400.
    await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: uniqueNumber(), carrierId: carA2, sipTrunkId: trunkA }).expect(400);
    // Nonexistent region → 400.
    await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: uniqueNumber(), regionId: "00000000-0000-7000-8000-000000000000" }).expect(400);

    // Deleted carrier / trunk rejected.
    const carDel = await makeCarrier(a.token, "cdel");
    const trunkDel = await makeTrunk(a.token, "tdel", carDel);
    await request(http).delete(`/v1/telecom/sip-trunks/${trunkDel}`).set(auth(a.token)).expect(204);
    await request(http).delete(`/v1/telecom/carriers/${carDel}`).set(auth(a.token)).expect(204);
    await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: uniqueNumber(), carrierId: carDel }).expect(400);
    await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: uniqueNumber(), sipTrunkId: trunkDel }).expect(400);
  });
});

describe("security + audit + pagination", () => {
  it("ignores client-supplied ownership (mass assignment) and audits references only", async () => {
    const a = await provision("da", TenantType.CUSTOMER, "owner");
    // CreateDidDto strips unknown keys → tenantId ignored; DID owned by A.
    const res = await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: uniqueNumber(), tenantId: "00000000-0000-7000-8000-000000000000", scope: "SYSTEM" });
    expect(res.status).toBe(201);
    await request(http).get(`/v1/telecom/dids/${res.body.id}`).set(auth(a.token)).expect(200);
    // UpdateDidDto is strict → unknown ownership key rejected (400).
    await request(http).patch(`/v1/telecom/dids/${res.body.id}`).set(auth(a.token)).send({ tenantId: "00000000-0000-7000-8000-000000000000" }).expect(400);
    const logs = await request(http).get("/v1/audit-logs").set(auth(a.token));
    expect(logs.body.some((l: { action: string }) => l.action === "telecom.did.created")).toBe(true);
  });

  it("paginates deterministically and reports honest UNKNOWN health", async () => {
    const a = await provision("da", TenantType.CUSTOMER, "owner");
    for (let i = 0; i < 3; i++) await request(http).post("/v1/telecom/dids").set(auth(a.token)).send({ number: uniqueNumber() });
    const first = await request(http).get("/v1/telecom/dids?limit=2").set(auth(a.token));
    expect(first.body.items.length).toBe(2);
    expect(first.body.items[0].health.status).toBe("UNKNOWN");
    expect(first.body.nextCursor).toBeTruthy();
    const next = await request(http).get(`/v1/telecom/dids?limit=2&cursor=${first.body.nextCursor}`).set(auth(a.token));
    const firstIds = new Set(first.body.items.map((x: { id: string }) => x.id));
    expect(next.body.items.every((x: { id: string }) => !firstIds.has(x.id))).toBe(true);
  });
});
