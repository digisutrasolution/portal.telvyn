/**
 * Phase 12D — platform telecom infrastructure (Region / Engine / Node) e2e.
 * Real Postgres + Redis. Proves: PLATFORM-scope enforcement (a customer tenant
 * cannot touch platform infra even as owner), permission gating, validation,
 * referential integrity, audit integration, and HONEST health (UNKNOWN).
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
const CODE = `tst-${Date.now()}`; // unique region-code prefix for cleanup

async function flushRateLimits(): Promise<void> {
  const keys = await redis.keys("rl:*");
  if (keys.length) await redis.del(keys);
}
async function systemRole(key: string): Promise<string> {
  return (await prisma.role.findFirstOrThrow({ where: { tenantId: null, key } })).id;
}
/** Provision a user in a tenant of the given type with a system role → access token. */
async function provision(tag: string, type: TenantType, roleKey: string): Promise<{ token: string }> {
  const email = `${tag}.${Date.now()}.${Math.round(performance.now())}@telvyn.test`;
  const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" } });
  const tenant = await prisma.tenant.create({ data: { slug: `${tag}-${user.id}`, name: tag, type } });
  const membership = await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } });
  await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: await systemRole(roleKey) } });
  await prisma.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });
  const res = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
  return { token: res.body.accessToken };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flushRateLimits);
afterAll(async () => {
  await prisma.telecomNode.deleteMany({ where: { name: { startsWith: "tst-" } } });
  await prisma.telecomEngine.deleteMany({ where: { name: { startsWith: "tst-" } } });
  await prisma.region.deleteMany({ where: { code: { startsWith: "tst-" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: { in: ["plat", "cust", "plataudit"] } } });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("platform-scope enforcement", () => {
  it("rejects unauthenticated access (401)", async () => {
    await request(http).get("/v1/telecom/regions").expect(401);
  });

  it("denies a CUSTOMER-tenant owner even though it holds '*' (403)", async () => {
    const cust = await provision("cust", TenantType.CUSTOMER, "owner");
    await request(http).get("/v1/telecom/regions").set(auth(cust.token)).expect(403);
    await request(http).post("/v1/telecom/regions").set(auth(cust.token)).send({ code: `${CODE}-x`, name: "X", country: "US", timezone: "UTC" }).expect(403);
  });
});

describe("permission gating (within the platform tenant)", () => {
  it("a platform auditor can read but not mutate", async () => {
    const auditor = await provision("plataudit", TenantType.PLATFORM, "auditor");
    await request(http).get("/v1/telecom/regions").set(auth(auditor.token)).expect(200);
    await request(http).post("/v1/telecom/regions").set(auth(auditor.token)).send({ code: `${CODE}-a`, name: "A", country: "US", timezone: "UTC" }).expect(403);
  });
});

describe("platform CRUD + integrity + honest health", () => {
  it("runs the region → engine → capabilities → node → health flow", async () => {
    const plat = await provision("plat", TenantType.PLATFORM, "owner");

    // Region
    const region = await request(http).post("/v1/telecom/regions").set(auth(plat.token)).send({ code: `${CODE}-1`, name: "US East", country: "US", timezone: "America/New_York" });
    expect(region.status).toBe(201);
    const regionId = region.body.id;

    // Invalid body → 400
    await request(http).post("/v1/telecom/regions").set(auth(plat.token)).send({ code: "UPPER_BAD", name: "", country: "usa", timezone: "" }).expect(400);

    // Engine referencing the region
    const engine = await request(http).post("/v1/telecom/engines").set(auth(plat.token)).send({ name: `tst-kam`, type: "KAMAILIO", regionId });
    expect(engine.status).toBe(201);
    const engineId = engine.body.id;
    // HONEST: stub adapter → not implemented, health UNKNOWN, software profile present (no RTP for Kamailio)
    expect(engine.body.implemented).toBe(false);
    expect(engine.body.health.status).toBe("UNKNOWN");
    expect(engine.body.softwareCapabilities).toContain("SIP");
    expect(engine.body.softwareCapabilities).not.toContain("RTP");
    expect(engine.body.capabilities).toEqual([]); // none configured yet

    // Bad region reference → 400
    await request(http).post("/v1/telecom/engines").set(auth(plat.token)).send({ name: "tst-bad", type: "ASTERISK", regionId: "00000000-0000-7000-8000-000000000000" }).expect(400);

    // Configure enabled capabilities
    const caps = await request(http).put(`/v1/telecom/engines/${engineId}/capabilities`).set(auth(plat.token)).send({ capabilities: ["SIP", "REGISTRATION", "SIP"] });
    expect(caps.status).toBe(200);
    expect(caps.body.capabilities.sort()).toEqual(["REGISTRATION", "SIP"]);

    // Node referencing the engine → health snapshot starts UNKNOWN
    const node = await request(http).post("/v1/telecom/nodes").set(auth(plat.token)).send({ name: `tst-node`, engineId, regionId, maxCps: 50, maxConcurrentCalls: 500 });
    expect(node.status).toBe(201);
    const nodeId = node.body.id;
    expect(node.body.health.status).toBe("UNKNOWN");

    // Bad engine reference → 400
    await request(http).post("/v1/telecom/nodes").set(auth(plat.token)).send({ name: "tst-badnode", engineId: "00000000-0000-7000-8000-000000000000" }).expect(400);

    // Health endpoint (telecom.health.read) → UNKNOWN
    const health = await request(http).get(`/v1/telecom/nodes/${nodeId}/health`).set(auth(plat.token));
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("UNKNOWN");

    // Operator health-check POST is an action, not a resource creation → 200 (contract), honest UNKNOWN — Phase 12O-2ay
    const probe = await request(http).post(`/v1/telecom/nodes/${nodeId}/health-check`).set(auth(plat.token)).send({});
    expect(probe.status).toBe(200);
    expect(probe.body.status).toBe("UNKNOWN");

    // Heartbeat ingest (ADR-0020, 12O-2ba) FAILS CLOSED: no inbound mTLS terminator
    // is wired, so the Null authenticator yields no verified identity → 401. The
    // machine endpoint carries no JWT, so this is not an auth-token 401 — it is the
    // honest "no verified node-agent certificate". Nothing is ever accepted on a
    // spoofable signal; lastHeartbeatAt is NOT stamped.
    const beat = await request(http).post(`/v1/telecom/nodes/${nodeId}/heartbeat`).send({ version: "1.0" });
    expect(beat.status).toBe(401);
    const after = await request(http).get(`/v1/telecom/nodes/${nodeId}/health`).set(auth(plat.token));
    expect(after.body.lastHeartbeatAt ?? null).toBeNull(); // unchanged — the beat was rejected

    // Lists include the created rows
    expect((await request(http).get("/v1/telecom/nodes").set(auth(plat.token))).body.some((n: { id: string }) => n.id === nodeId)).toBe(true);

    // Update + delete
    await request(http).put(`/v1/telecom/nodes/${nodeId}`).set(auth(plat.token)).send({ maxCps: 100 }).expect(200);
    await request(http).delete(`/v1/telecom/nodes/${nodeId}`).set(auth(plat.token)).expect(204);
    await request(http).get(`/v1/telecom/nodes/${nodeId}`).set(auth(plat.token)).expect(404);

    // Audit trail recorded the platform mutations
    const logs = await request(http).get("/v1/audit-logs").set(auth(plat.token));
    const actions = logs.body.map((l: { action: string }) => l.action);
    expect(actions).toContain("telecom.region.created");
    expect(actions).toContain("telecom.engine.created");
    expect(actions).toContain("telecom.node.created");
  });
});
