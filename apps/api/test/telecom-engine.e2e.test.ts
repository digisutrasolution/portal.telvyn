import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12K — Engine abstraction e2e (real Postgres + Redis). Proves the
 * platform-scoped engine status/sync boundary: honest UNKNOWN health, honest
 * NOT_IMPLEMENTED sync (501), platform-only access, no secret exposure, audit.
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
const ename = () => `tste-${Date.now()}-${seq++}`;

async function flushRateLimits(): Promise<void> {
  const keys = await redis.keys("rl:*");
  if (keys.length) await redis.del(keys);
}
async function provision(type: TenantType, roleKey: string): Promise<{ token: string }> {
  const email = `eng.${Date.now()}.${Math.round(performance.now())}@telvyn.test`;
  const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" } });
  const tenant = await prisma.tenant.create({ data: { slug: `eng-${user.id}`, name: type === TenantType.PLATFORM ? "engplat" : "engcust", type } });
  const m = await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } });
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId: null, key: roleKey } });
  await prisma.membershipRole.create({ data: { membershipId: m.id, roleId: role.id } });
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
  await prisma.telecomEngine.deleteMany({ where: { name: { startsWith: "tste-" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: { in: ["engplat", "engcust"] } } });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("engine status + sync (platform)", () => {
  it("returns honest UNKNOWN status with explicit capabilities and no secrets", async () => {
    const plat = await provision(TenantType.PLATFORM, "owner");
    const engine = await request(http).post("/v1/telecom/engines").set(auth(plat.token)).send({ name: ename(), type: "KAMAILIO" });
    const id = engine.body.id;
    const status = await request(http).get(`/v1/telecom/engines/${id}/status`).set(auth(plat.token));
    expect(status.status).toBe(200);
    expect(status.body.implemented).toBe(false);
    expect(status.body.health.status).toBe("UNKNOWN"); // never fabricated HEALTHY
    expect(status.body.capabilities.routing).toBe(true);
    expect(status.body.capabilities.originate).toBe(false); // Kamailio signalling
    expect(status.body.correlationId).toBeTruthy();
    expect(JSON.stringify(status.body)).not.toMatch(/secret|password/i);
  });

  it("sync returns honest 501 NOT_IMPLEMENTED and audits the attempt", async () => {
    const plat = await provision(TenantType.PLATFORM, "owner");
    const engine = await request(http).post("/v1/telecom/engines").set(auth(plat.token)).send({ name: ename(), type: "FREESWITCH" });
    const id = engine.body.id;
    const sync = await request(http).post(`/v1/telecom/engines/${id}/sync`).set(auth(plat.token)).send({});
    expect(sync.status).toBe(501); // honest — no fake success
    const logs = await request(http).get("/v1/audit-logs").set(auth(plat.token));
    const entry = logs.body.find((l: { action: string }) => l.action === "telecom.engine.sync_attempted");
    expect(entry).toBeTruthy();
    expect(entry.metadata.outcome).toBe("NOT_IMPLEMENTED");
    expect(JSON.stringify(logs.body)).not.toMatch(/secret|password/i);
  });

  it("nonexistent engine → 404", async () => {
    const plat = await provision(TenantType.PLATFORM, "owner");
    await request(http).get("/v1/telecom/engines/00000000-0000-7000-8000-000000000000/status").set(auth(plat.token)).expect(404);
  });
});

describe("platform-scope + auth", () => {
  it("rejects unauthenticated (401) and a customer tenant (403)", async () => {
    await request(http).get("/v1/telecom/engines/00000000-0000-7000-8000-000000000000/status").expect(401);
    const plat = await provision(TenantType.PLATFORM, "owner");
    const engine = await request(http).post("/v1/telecom/engines").set(auth(plat.token)).send({ name: ename(), type: "ASTERISK" });
    const cust = await provision(TenantType.CUSTOMER, "owner");
    await request(http).get(`/v1/telecom/engines/${engine.body.id}/status`).set(auth(cust.token)).expect(403); // PlatformGuard
    await request(http).post(`/v1/telecom/engines/${engine.body.id}/sync`).set(auth(cust.token)).send({}).expect(403);
  });
});
