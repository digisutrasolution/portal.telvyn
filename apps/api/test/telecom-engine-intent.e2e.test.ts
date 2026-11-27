import "./e2e-guard"; // INC-DB-001B: two-stage target guard — must stay the FIRST import
import { RUN_EMAIL_SUFFIX, RUN_ID, ownedUserWhere, resetRunRateLimits } from "./e2e-run";
import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12N-3 — desired config intent from assignments (real Postgres + Redis).
 * Proves GET :id/status.desired reflects the engine's ENABLED resource
 * assignments (non-empty intent + fingerprint), and that disabling/unassigning a
 * resource changes the counts and the fingerprint.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import * as argon2 from "argon2";
import Redis from "ioredis";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { TenantType, TelecomEngineType, EngineResourceKind } from "@prisma/client";

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
const TAG = `tnra3-${RUN_ID}`;
let seq = 0;

async function flushRateLimits(): Promise<void> {
  await resetRunRateLimits(redis);
}
async function platformToken(): Promise<string> {
  const email = `int.${Date.now()}.${seq++}${RUN_EMAIL_SUFFIX}`;
  const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" } });
  const tenant = await prisma.tenant.create({ data: { slug: `${TAG}-${seq++}`, name: `${TAG}`, type: TenantType.PLATFORM } });
  const m = await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } });
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId: null, key: "owner" } });
  await prisma.membershipRole.create({ data: { membershipId: m.id, roleId: role.id } });
  await prisma.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });
  const res = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
  return res.body.accessToken;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let token: string;
let engineId: string;
let trunkId: string;
let didId: string;
let profileId: string;

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  token = await platformToken();

  const tenant = await prisma.tenant.create({ data: { slug: `${TAG}-res`, name: `${TAG}`, type: TenantType.CUSTOMER } });
  const carrier = await prisma.carrier.create({ data: { name: `${TAG}-car`, tenantId: tenant.id } });
  engineId = (await prisma.telecomEngine.create({ data: { name: `${TAG}-eng`, type: TelecomEngineType.KAMAILIO } })).id;
  trunkId = (await prisma.sipTrunk.create({ data: { name: `${TAG}-trunk`, tenantId: tenant.id, carrierId: carrier.id } })).id;
  didId = (await prisma.did.create({ data: { e164: `+1999${String(Date.now()).slice(-7)}`, country: "US", tenantId: tenant.id } })).id;
  const profile = await prisma.routingProfile.create({ data: { name: `${TAG}-rp`, tenantId: tenant.id } });
  profileId = profile.id;
  await prisma.routingRule.create({ data: { routingProfileId: profile.id, destinationType: "EXTENSION", destination: "1000", priority: 100 } });
});

beforeEach(flushRateLimits);

afterAll(async () => {
  await prisma.engineResourceAssignment.deleteMany({ where: { engine: { name: { startsWith: TAG } } } });
  await prisma.routingRule.deleteMany({ where: { routingProfile: { name: { startsWith: TAG } } } });
  await prisma.telecomEngine.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.did.deleteMany({ where: { tenant: { name: { startsWith: TAG } } } });
  await prisma.sipTrunk.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.routingProfile.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.carrier.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.membershipRole.deleteMany({ where: { membership: { tenant: { name: { startsWith: TAG } } } } });
  await prisma.membership.deleteMany({ where: { tenant: { name: { startsWith: TAG } } } });
  await prisma.user.deleteMany({ where: ownedUserWhere() });
  await prisma.tenant.deleteMany({ where: { name: { startsWith: TAG } } });
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
});

const assignments = () => `/v1/telecom/engines/${engineId}/assignments`;
const status = () => `/v1/telecom/engines/${engineId}/status`;

describe("Engine desired config intent from assignments", () => {
  it("empty engine → empty desired summary", async () => {
    const res = await request(http).get(status()).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.desired.summary).toEqual({ carriers: 0, trunks: 0, dids: 0, routes: 0 });
  });

  it("assigning resources populates the desired intent (and a fingerprint)", async () => {
    await request(http).post(assignments()).set(auth(token)).send({ kind: EngineResourceKind.SIP_TRUNK, resourceId: trunkId });
    await request(http).post(assignments()).set(auth(token)).send({ kind: EngineResourceKind.DID, resourceId: didId });
    await request(http).post(assignments()).set(auth(token)).send({ kind: EngineResourceKind.ROUTING_PROFILE, resourceId: profileId });

    const res = await request(http).get(status()).set(auth(token));
    expect(res.body.desired.summary).toEqual({ carriers: 1, trunks: 1, dids: 1, routes: 1 });
    expect(typeof res.body.desired.version).toBe("string");
    expect(res.body.desired.version.length).toBeGreaterThan(0);
  });

  it("disabling an assignment removes it from the desired intent and changes the fingerprint", async () => {
    const before = (await request(http).get(status()).set(auth(token))).body.desired.version;
    const list = (await request(http).get(assignments()).set(auth(token))).body;
    const trunkA = list.find((a: { resource: { id: string }; id: string }) => a.resource.id === trunkId);
    await request(http).patch(`${assignments()}/${trunkA.id}`).set(auth(token)).send({ enabled: false });

    const res = await request(http).get(status()).set(auth(token));
    expect(res.body.desired.summary.trunks).toBe(0);
    expect(res.body.desired.summary.carriers).toBe(0); // the trunk's carrier is no longer referenced
    expect(res.body.desired.version).not.toBe(before);
  });
});
