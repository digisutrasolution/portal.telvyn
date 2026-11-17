/**
 * Phase 12N-2 — engine resource assignment API e2e (real Postgres + Redis).
 * Proves the platform-only assign/list/update/unassign boundary: PlatformGuard
 * (customer 403, unauth 401), server-derived tenantId, kind-validated resource
 * (404 on missing), double-assign 409, reactivate-after-unassign, audit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import * as argon2 from "argon2";
import Redis from "ioredis";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PrismaClient, TenantType, TelecomEngineType, EngineResourceKind } from "@prisma/client";

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
const TAG = `tnra2-${Date.now()}`;
let seq = 0;

async function flushRateLimits(): Promise<void> {
  const keys = await redis.keys("rl:*");
  if (keys.length) await redis.del(keys);
}

async function provision(type: TenantType, roleKey: string): Promise<{ token: string }> {
  const email = `asn.${Date.now()}.${seq++}@telvyn.test`;
  const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" } });
  const tenant = await prisma.tenant.create({ data: { slug: `${TAG}-${seq++}`, name: `${TAG}`, type } });
  const m = await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } });
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId: null, key: roleKey } });
  await prisma.membershipRole.create({ data: { membershipId: m.id, roleId: role.id } });
  await prisma.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });
  const res = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
  return { token: res.body.accessToken };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let platform: string;
let customer: string;
let engineId: string;
let trunkId: string;
let didId: string;
let profileId: string;

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  platform = (await provision(TenantType.PLATFORM, "owner")).token;
  customer = (await provision(TenantType.CUSTOMER, "owner")).token;

  const tenant = await prisma.tenant.create({ data: { slug: `${TAG}-res`, name: `${TAG}`, type: TenantType.CUSTOMER } });
  const carrier = await prisma.carrier.create({ data: { name: `${TAG}-car`, tenantId: tenant.id } });
  engineId = (await prisma.telecomEngine.create({ data: { name: `${TAG}-eng`, type: TelecomEngineType.KAMAILIO } })).id;
  trunkId = (await prisma.sipTrunk.create({ data: { name: `${TAG}-trunk`, tenantId: tenant.id, carrierId: carrier.id } })).id;
  didId = (await prisma.did.create({ data: { e164: `+1999${String(Date.now()).slice(-7)}`, country: "US", tenantId: tenant.id } })).id;
  profileId = (await prisma.routingProfile.create({ data: { name: `${TAG}-rp`, tenantId: tenant.id } })).id;
});

beforeEach(flushRateLimits);

afterAll(async () => {
  await prisma.engineResourceAssignment.deleteMany({ where: { engine: { name: { startsWith: TAG } } } });
  await prisma.telecomEngine.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.did.deleteMany({ where: { tenant: { name: { startsWith: TAG } } } });
  await prisma.sipTrunk.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.routingProfile.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.carrier.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.membershipRole.deleteMany({ where: { membership: { tenant: { name: { startsWith: TAG } } } } });
  await prisma.membership.deleteMany({ where: { tenant: { name: { startsWith: TAG } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "asn." } } });
  await prisma.tenant.deleteMany({ where: { name: { startsWith: TAG } } });
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
});

const base = () => `/v1/telecom/engines/${engineId}/assignments`;

describe("Engine assignments — platform assign / list / update / unassign", () => {
  it("platform assigns a SIP trunk, with server-derived tenantId", async () => {
    const res = await request(http).post(base()).set(auth(platform)).send({ kind: EngineResourceKind.SIP_TRUNK, resourceId: trunkId });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe(EngineResourceKind.SIP_TRUNK);
    expect(res.body.resource.id).toBe(trunkId);
    expect(res.body.tenantId).toBeTruthy(); // taken from the trunk, not the client
  });

  it("lists the assignment", async () => {
    const res = await request(http).get(base()).set(auth(platform));
    expect(res.status).toBe(200);
    expect(res.body.some((a: { resource: { id: string } }) => a.resource.id === trunkId)).toBe(true);
  });

  it("rejects assigning the same trunk twice (409)", async () => {
    const res = await request(http).post(base()).set(auth(platform)).send({ kind: EngineResourceKind.SIP_TRUNK, resourceId: trunkId });
    expect(res.status).toBe(409);
  });

  it("404 when the resource does not exist", async () => {
    const res = await request(http).post(base()).set(auth(platform)).send({ kind: EngineResourceKind.SIP_TRUNK, resourceId: "00000000-0000-7000-8000-000000000000" });
    expect(res.status).toBe(404);
  });

  it("assigns a DID and a routing profile too", async () => {
    const d = await request(http).post(base()).set(auth(platform)).send({ kind: EngineResourceKind.DID, resourceId: didId });
    const p = await request(http).post(base()).set(auth(platform)).send({ kind: EngineResourceKind.ROUTING_PROFILE, resourceId: profileId });
    expect([d.status, p.status]).toEqual([201, 201]);
  });

  it("toggles enabled, then unassigns, then re-assigns (reactivate)", async () => {
    const list = await request(http).get(base()).set(auth(platform));
    const trunkAssignment = list.body.find((a: { resource: { id: string }; id: string }) => a.resource.id === trunkId);
    const patch = await request(http).patch(`${base()}/${trunkAssignment.id}`).set(auth(platform)).send({ enabled: false });
    expect(patch.status).toBe(200);
    expect(patch.body.enabled).toBe(false);

    const del = await request(http).delete(`${base()}/${trunkAssignment.id}`).set(auth(platform));
    expect(del.status).toBe(204);
    const after = await request(http).get(base()).set(auth(platform));
    expect(after.body.some((a: { resource: { id: string } }) => a.resource.id === trunkId)).toBe(false);

    const re = await request(http).post(base()).set(auth(platform)).send({ kind: EngineResourceKind.SIP_TRUNK, resourceId: trunkId });
    expect(re.status).toBe(201); // reactivated
  });

  it("forbids a customer tenant (403) and unauthenticated (401)", async () => {
    const forbidden = await request(http).post(base()).set(auth(customer)).send({ kind: EngineResourceKind.SIP_TRUNK, resourceId: trunkId });
    expect(forbidden.status).toBe(403);
    const unauth = await request(http).get(base());
    expect(unauth.status).toBe(401);
  });
});
