import "./e2e-guard"; // INC-DB-001B: two-stage target guard — must stay the FIRST import
import { RUN_EMAIL_SUFFIX, ownedTenantWhere, ownedUserWhere, resetRunRateLimits, runPrefix } from "./e2e-run";
import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12L — engine runtime foundation e2e (real Postgres + Redis). Proves the
 * platform-scoped runtime boundary: honest status posture (UNCONFIGURED /
 * UNVERIFIED, applied version null), honest health probe (UNKNOWN, NullConnector),
 * versioned+audited sync (→501), SSRF-guarded endpoint config, rollback guard,
 * platform-only access, and NO secret exposure.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import * as argon2 from "argon2";
import Redis from "ioredis";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { TenantType } from "@prisma/client";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");

import { createApp } from "../src/main";
import { ARGON2_OPTIONS } from "../src/auth/account-flows.service";

/** Run-scoped name prefix (INC-DB-001B): only this run's rows match cleanup. */
const TST = runPrefix("tstl");

const prisma = fixturePrisma;
const redis = new Redis(process.env.REDIS_URL!);
let app: NestExpressApplication;
let http: ReturnType<NestExpressApplication["getHttpServer"]>;
const PASSWORD = "correct-horse-battery-staple-9";
const TRANSPORT = { "x-token-transport": "body" } as const;
let seq = 0;
const ename = () => `${TST}${Date.now()}-${seq++}`;

async function flushRateLimits(): Promise<void> {
  await resetRunRateLimits(redis);
}
async function provision(type: TenantType, roleKey: string): Promise<{ token: string }> {
  const email = `engl.${Date.now()}.${Math.round(performance.now())}${RUN_EMAIL_SUFFIX}`;
  const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" } });
  const tenant = await prisma.tenant.create({ data: { slug: `engl-${user.id}`, name: type === TenantType.PLATFORM ? "englplat" : "englcust", type } });
  const m = await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } });
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId: null, key: roleKey } });
  await prisma.membershipRole.create({ data: { membershipId: m.id, roleId: role.id } });
  await prisma.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });
  const res = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
  return { token: res.body.accessToken };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function makeEngine(token: string, body: Record<string, unknown> = {}) {
  return request(http).post("/v1/telecom/engines").set(auth(token)).send({ name: ename(), type: "KAMAILIO", ...body });
}

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flushRateLimits);
afterAll(async () => {
  // Resolve run-owned tenants BEFORE their owning users are deleted.
  const ownedTenants = await ownedTenantWhere(prisma, ["englplat", "englcust"]);
  const engines = await prisma.telecomEngine.findMany({ where: { name: { startsWith: TST } }, select: { id: true } });
  const ids = engines.map((e) => e.id);
  if (ids.length) {
    await prisma.telecomConfigVersion.deleteMany({ where: { entityType: "engine", entityId: { in: ids } } });
    await prisma.healthEvent.deleteMany({ where: { entityType: "ENGINE", entityId: { in: ids } } });
  }
  await prisma.telecomEngine.deleteMany({ where: { name: { startsWith: TST } } });
  await prisma.user.deleteMany({ where: ownedUserWhere() });
  await prisma.tenant.deleteMany({ where: ownedTenants });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("runtime status posture (honest)", () => {
  it("status reports connection + version posture with no applied version and no secrets", async () => {
    const plat = await provision(TenantType.PLATFORM, "owner");
    const engine = await makeEngine(plat.token);
    const status = await request(http).get(`/v1/telecom/engines/${engine.body.id}/status`).set(auth(plat.token));
    expect(status.status).toBe(200);
    expect(status.body.health.status).toBe("UNKNOWN");
    expect(status.body.connection.state).toBe("UNCONFIGURED"); // no endpoint
    expect(status.body.connection.endpointConfigured).toBe(false);
    expect(status.body.version.appliedVersion).toBeNull(); // nothing applied — honest
    expect(JSON.stringify(status.body)).not.toMatch(/secret|password/i);
  });

  it("a valid public endpoint on an ACTIVE engine is UNVERIFIED (SSRF passed, no live egress)", async () => {
    const plat = await provision(TenantType.PLATFORM, "owner");
    const engine = await makeEngine(plat.token, { endpoint: "https://kam.telvyn.example", status: "ACTIVE" });
    expect(engine.status).toBe(201);
    const status = await request(http).get(`/v1/telecom/engines/${engine.body.id}/status`).set(auth(plat.token));
    expect(status.body.connection.state).toBe("UNVERIFIED");
    expect(status.body.connection.endpointConfigured).toBe(true);
  });
});

describe("SSRF-guarded endpoint configuration", () => {
  it("rejects a private/metadata management endpoint at config time (400)", async () => {
    const plat = await provision(TenantType.PLATFORM, "owner");
    expect((await makeEngine(plat.token, { endpoint: "http://169.254.169.254" })).status).toBe(400);
    expect((await makeEngine(plat.token, { endpoint: "http://127.0.0.1:8080" })).status).toBe(400);
    expect((await makeEngine(plat.token, { endpoint: "not-a-url" })).status).toBe(400);
  });
});

describe("health probe (honest, audited)", () => {
  it("health-check returns UNKNOWN and audits the probe", async () => {
    const plat = await provision(TenantType.PLATFORM, "owner");
    const engine = await makeEngine(plat.token);
    const res = await request(http).post(`/v1/telecom/engines/${engine.body.id}/health-check`).set(auth(plat.token)).send({});
    expect(res.status).toBe(200); // operator action, not a resource creation (contract: 200) — Phase 12O-2ay
    expect(res.body.status).toBe("UNKNOWN"); // NullConnector — never fabricated
    expect(res.body.reachability).toBe("UNCONFIGURED");
    const logs = await request(http).get("/v1/audit-logs").set(auth(plat.token));
    expect(logs.body.some((l: { action: string }) => l.action === "telecom.engine.health_checked")).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|password/i);
  });
});

describe("versioned sync + rollback (honest)", () => {
  it("sync returns 501 NOT_IMPLEMENTED with a desired version, and audits it", async () => {
    const plat = await provision(TenantType.PLATFORM, "owner");
    const engine = await makeEngine(plat.token);
    const res = await request(http).post(`/v1/telecom/engines/${engine.body.id}/sync`).set(auth(plat.token)).send({});
    expect(res.status).toBe(501);
    const logs = await request(http).get("/v1/audit-logs").set(auth(plat.token));
    const entry = logs.body.find((l: { action: string }) => l.action === "telecom.engine.sync_attempted");
    expect(entry).toBeTruthy();
    expect(entry.metadata.outcome).toBe("NOT_IMPLEMENTED");
    expect(entry.metadata.desiredVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(entry.metadata.appliedVersion).toBeNull();
  });

  it("rollback without a previous version → 400", async () => {
    const plat = await provision(TenantType.PLATFORM, "owner");
    const engine = await makeEngine(plat.token);
    await request(http).post(`/v1/telecom/engines/${engine.body.id}/sync`).set(auth(plat.token)).send({}); // one desired version
    await request(http).post(`/v1/telecom/engines/${engine.body.id}/sync/rollback`).set(auth(plat.token)).send({}).expect(400);
  });
});

describe("platform-scope + auth on runtime endpoints", () => {
  it("customer tenant → 403; unauthenticated → 401; nonexistent → 404", async () => {
    const plat = await provision(TenantType.PLATFORM, "owner");
    const engine = await makeEngine(plat.token);
    const id = engine.body.id;

    await request(http).post(`/v1/telecom/engines/${id}/health-check`).expect(401);
    await request(http).post(`/v1/telecom/engines/${id}/sync`).expect(401);

    const cust = await provision(TenantType.CUSTOMER, "owner");
    await request(http).get(`/v1/telecom/engines/${id}/status`).set(auth(cust.token)).expect(403);
    await request(http).post(`/v1/telecom/engines/${id}/health-check`).set(auth(cust.token)).send({}).expect(403);
    await request(http).post(`/v1/telecom/engines/${id}/sync`).set(auth(cust.token)).send({}).expect(403);
    await request(http).post(`/v1/telecom/engines/${id}/sync/rollback`).set(auth(cust.token)).send({}).expect(403);

    await request(http).get("/v1/telecom/engines/00000000-0000-7000-8000-0000000000ff/status").set(auth(plat.token)).expect(404);
  });
});
