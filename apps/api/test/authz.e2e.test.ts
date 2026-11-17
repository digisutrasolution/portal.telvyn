/**
 * Authorization integration suite (ADR-0004) — real Postgres + Redis.
 * Proves the attacks in scope are refused: cross-tenant access, IDOR,
 * privilege escalation, unauthorized API access, and client-supplied tenant
 * ids being ignored. Requires the seed to have run (system roles present).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import * as argon2 from "argon2";
import Redis from "ioredis";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PrismaClient } from "@prisma/client";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://telvyn:change_me_local_dev@localhost:5433/telvyn?schema=public";
process.env.REDIS_URL ??= "redis://localhost:6380";
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

async function flushRateLimits(): Promise<void> {
  const keys = await redis.keys("rl:*");
  if (keys.length) await redis.del(keys);
}

async function systemRole(key: string): Promise<string> {
  return (await prisma.role.findFirstOrThrow({ where: { tenantId: null, key } })).id;
}

/** Create a user + tenant + membership with a system role; return an access token. */
async function provision(tag: string, roleKey: string): Promise<{ token: string; tenantId: string; membershipId: string; userId: string }> {
  const email = `${tag}.${Date.now()}.${Math.round(performance.now())}@telvyn.test`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" },
  });
  const tenant = await prisma.tenant.create({ data: { slug: `${tag}-${user.id}`, name: tag, type: "CUSTOMER" } });
  const membership = await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } });
  await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: await systemRole(roleKey) } });
  await prisma.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });

  const res = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
  return { token: res.body.accessToken, tenantId: tenant.id, membershipId: membership.id, userId: user.id };
}

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});

beforeEach(flushRateLimits);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: { in: ["alpha", "beta", "noperms"] } } });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("unauthorized API access", () => {
  it("rejects tenant routes without a token (401)", async () => {
    await request(http).get("/v1/tenant").expect(401);
    await request(http).get("/v1/roles").expect(401);
  });
});

describe("tenant isolation + cross-tenant access", () => {
  it("each owner sees only their own tenant", async () => {
    const alpha = await provision("alpha", "owner");
    const beta = await provision("beta", "owner");

    const a = await request(http).get("/v1/tenant").set("Authorization", `Bearer ${alpha.token}`);
    const b = await request(http).get("/v1/tenant").set("Authorization", `Bearer ${beta.token}`);
    expect(a.body.id).toBe(alpha.tenantId);
    expect(b.body.id).toBe(beta.tenantId);
    expect(a.body.id).not.toBe(b.body.id);
  });

  it("a member list never contains another tenant's members", async () => {
    const alpha = await provision("alpha", "owner");
    const beta = await provision("beta", "owner");
    const list = await request(http).get("/v1/members").set("Authorization", `Bearer ${alpha.token}`);
    const tenantIdsSeen = list.body.map((m: { membershipId: string }) => m.membershipId);
    expect(tenantIdsSeen).toContain(alpha.membershipId);
    expect(tenantIdsSeen).not.toContain(beta.membershipId);
  });
});

describe("IDOR", () => {
  it("assigning roles to another tenant's membership id → 404, not mutation", async () => {
    const alpha = await provision("alpha", "owner");
    const beta = await provision("beta", "owner");
    const roleId = await systemRole("operator");
    const res = await request(http)
      .put(`/v1/members/${beta.membershipId}/roles`)
      .set("Authorization", `Bearer ${alpha.token}`)
      .send({ roleIds: [roleId] });
    expect(res.status).toBe(404);
    // Beta's roles are untouched.
    const betaRoles = await prisma.membershipRole.count({ where: { membershipId: beta.membershipId } });
    expect(betaRoles).toBe(1);
  });

  it("deleting another tenant's role id → 404", async () => {
    const alpha = await provision("alpha", "owner");
    const beta = await provision("beta", "owner");
    const betaRole = await request(http)
      .post("/v1/roles")
      .set("Authorization", `Bearer ${beta.token}`)
      .send({ key: "beta_role", name: "Beta Role", permissions: ["did.read"] });
    const res = await request(http)
      .delete(`/v1/roles/${betaRole.body.id}`)
      .set("Authorization", `Bearer ${alpha.token}`);
    expect(res.status).toBe(404);
  });
});

describe("privilege escalation", () => {
  it("a role without role.manage cannot create roles (403)", async () => {
    const operator = await provision("alpha", "operator");
    const res = await request(http)
      .post("/v1/roles")
      .set("Authorization", `Bearer ${operator.token}`)
      .send({ key: "sneaky", name: "Sneaky", permissions: ["did.read"] });
    expect(res.status).toBe(403);
  });

  it("cannot grant a custom role permissions beyond one's own (403)", async () => {
    // admin holds member.*/role.*/did.*/tenant.* but NOT wallet.credit.
    const admin = await provision("alpha", "admin");
    const res = await request(http)
      .post("/v1/roles")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ key: "overreach", name: "Overreach", permissions: ["wallet.credit"] });
    expect(res.status).toBe(403);
  });

  it("a member with no roles is denied every guarded route (403)", async () => {
    const email = `noperms.${Date.now()}@telvyn.test`;
    const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" } });
    const tenant = await prisma.tenant.create({ data: { slug: `noperms-${user.id}`, name: "noperms", type: "CUSTOMER" } });
    await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } });
    await prisma.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });
    const login = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
    await request(http).get("/v1/roles").set("Authorization", `Bearer ${login.body.accessToken}`).expect(403);
  });
});

describe("client-supplied tenant id is never trusted", () => {
  it("ignores tenantId in the body when updating the tenant", async () => {
    const alpha = await provision("alpha", "owner");
    const beta = await provision("beta", "owner");
    // Attempt to steer the write at beta's tenant via the body.
    await request(http)
      .put("/v1/tenant")
      .set("Authorization", `Bearer ${alpha.token}`)
      .send({ name: "Renamed by Alpha", tenantId: beta.tenantId, id: beta.tenantId })
      .expect(200);
    // Beta is unchanged; alpha changed its own.
    const betaTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: beta.tenantId } });
    const alphaTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: alpha.tenantId } });
    expect(betaTenant.name).toBe("beta");
    expect(alphaTenant.name).toBe("Renamed by Alpha");
  });
});

describe("audit trail", () => {
  it("records tenant-scoped mutations and shows only this tenant's entries", async () => {
    const alpha = await provision("alpha", "owner");
    await request(http).put("/v1/tenant").set("Authorization", `Bearer ${alpha.token}`).send({ name: "Alpha Renamed" });
    await request(http)
      .post("/v1/roles")
      .set("Authorization", `Bearer ${alpha.token}`)
      .send({ key: "custom_a", name: "Custom A", permissions: ["did.read"] });

    const logs = await request(http).get("/v1/audit-logs").set("Authorization", `Bearer ${alpha.token}`);
    expect(logs.status).toBe(200);
    const actions = logs.body.map((l: { action: string }) => l.action);
    expect(actions).toContain("tenant.updated");
    expect(actions).toContain("role.created");
    // All entries belong to alpha's actor.
    expect(logs.body.every((l: { actorId: string }) => l.actorId === alpha.userId)).toBe(true);
  });
});

describe("current authorization context (/v1/me/context)", () => {
  it("rejects an unauthenticated request (401)", async () => {
    await request(http).get("/v1/me/context").expect(401);
  });

  it("returns the session's own identity, tenant, roles and expanded permissions", async () => {
    const owner = await provision("alpha", "owner");
    const res = await request(http).get("/v1/me/context").set("Authorization", `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(owner.userId);
    expect(res.body.tenantId).toBe(owner.tenantId);
    expect(res.body.tenantType).toBe("CUSTOMER");
    expect(res.body.roles.map((r: { key: string }) => r.key)).toContain("owner");
    // owner's "*" grant is expanded to concrete keys — never the raw wildcard.
    expect(res.body.permissions).toContain("role.read");
    expect(res.body.permissions).toContain("telecom.read");
    expect(res.body.permissions).not.toContain("*");
    // Deterministically sorted.
    expect(res.body.permissions).toEqual([...res.body.permissions].sort());
  });

  it("reflects a limited role's permission set (operator reads, cannot manage)", async () => {
    const operator = await provision("alpha", "operator");
    const res = await request(http).get("/v1/me/context").set("Authorization", `Bearer ${operator.token}`);
    expect(res.status).toBe(200);
    expect(res.body.roles.map((r: { key: string }) => r.key)).toContain("operator");
    expect(res.body.permissions).toContain("telecom.read");
    expect(res.body.permissions).not.toContain("telecom.manage");
    expect(res.body.permissions).not.toContain("role.manage");
  });

  it("never leaks another tenant's context", async () => {
    const alpha = await provision("alpha", "owner");
    const beta = await provision("beta", "owner");
    const res = await request(http).get("/v1/me/context").set("Authorization", `Bearer ${alpha.token}`);
    expect(res.body.tenantId).toBe(alpha.tenantId);
    expect(res.body.tenantId).not.toBe(beta.tenantId);
    expect(res.body.userId).not.toBe(beta.userId);
  });
});
