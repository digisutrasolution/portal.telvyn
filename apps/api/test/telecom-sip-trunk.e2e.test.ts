/**
 * Phase 12F — SIP trunk foundation e2e (real Postgres + Redis). Proves:
 * tenant isolation + IDOR (auto-scoped), carrier authorization, credential
 * ownership/type + secret secrecy, SSRF/CRLF-hostile input rejection, RBAC,
 * validation, mass-assignment protection, honest health, pagination.
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
const SECRET = "sip-trunk-secret-DO-NOT-LEAK-7k2x";

async function flushRateLimits(): Promise<void> {
  const keys = await redis.keys("rl:*");
  if (keys.length) await redis.del(keys);
}
async function systemRole(key: string): Promise<string> {
  return (await prisma.role.findFirstOrThrow({ where: { tenantId: null, key } })).id;
}
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

async function makeCarrier(token: string, name: string, cred?: { type: string }): Promise<{ carrierId: string; credId: string | null }> {
  const body: Record<string, unknown> = { name: `tstt-${name}` };
  if (cred) body.credential = { type: cred.type, label: `tstt-${name}`, hint: "u", secret: SECRET };
  const res = await request(http).post("/v1/telecom/carriers").set(auth(token)).send(body);
  return { carrierId: res.body.id, credId: res.body.credential?.id ?? null };
}
const trunkBody = (name: string, carrierId: string, extra: Record<string, unknown> = {}) => ({ name: `tstt-${name}`, carrierId, ...extra });

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flushRateLimits);
afterAll(async () => {
  await prisma.sipTrunk.deleteMany({ where: { name: { startsWith: "tstt-" } } });
  await prisma.carrier.deleteMany({ where: { name: { startsWith: "tstt-" } } });
  await prisma.telecomCredential.deleteMany({ where: { label: { startsWith: "tstt-" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: { in: ["ta", "tb", "tplat", "top"] } } });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("RBAC + CRUD", () => {
  it("rejects unauthenticated access (401)", async () => {
    await request(http).get("/v1/telecom/sip-trunks").expect(401);
  });

  it("operator (sip_trunk.read only) reads but cannot create (403)", async () => {
    const op = await provision("top", TenantType.CUSTOMER, "operator");
    const { carrierId } = await makeCarrier(op.token, "opcar"); // operator lacks carrier.create → this 403s
    await request(http).get("/v1/telecom/sip-trunks").set(auth(op.token)).expect(200);
    // Even with a (hypothetical) carrier, create is blocked by permission.
    await request(http).post("/v1/telecom/sip-trunks").set(auth(op.token)).send(trunkBody("x", carrierId ?? "00000000-0000-7000-8000-000000000000")).expect(403);
  });

  it("owner creates, reads, updates, soft-deletes a trunk (with inline SIP credential)", async () => {
    const a = await provision("ta", TenantType.CUSTOMER, "owner");
    const { carrierId } = await makeCarrier(a.token, "crud");
    const created = await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(
      trunkBody("t1", carrierId, { host: "sip.example.com", port: 5060, transport: "TLS", direction: "OUTBOUND", credential: { label: "tstt-c", hint: "u1", secret: SECRET } }),
    );
    expect(created.status).toBe(201);
    expect(created.body.credential.id).toBeTruthy();
    expect(created.body.credential.type).toBe("SIP_PASSWORD");
    expect(JSON.stringify(created.body)).not.toContain(SECRET);
    const id = created.body.id;
    await request(http).get(`/v1/telecom/sip-trunks/${id}`).set(auth(a.token)).expect(200);
    const upd = await request(http).patch(`/v1/telecom/sip-trunks/${id}`).set(auth(a.token)).send({ status: "ACTIVE", maxCps: 10 });
    expect(upd.body.status).toBe("ACTIVE");
    await request(http).delete(`/v1/telecom/sip-trunks/${id}`).set(auth(a.token)).expect(204);
    await request(http).get(`/v1/telecom/sip-trunks/${id}`).set(auth(a.token)).expect(404);
  });
});

describe("carrier authorization", () => {
  it("accepts own/system carriers; rejects foreign, deleted, and nonexistent", async () => {
    const a = await provision("ta", TenantType.CUSTOMER, "owner");
    const b = await provision("tb", TenantType.CUSTOMER, "owner");
    const plat = await provision("tplat", TenantType.PLATFORM, "owner");
    const own = await makeCarrier(a.token, "own");
    const foreign = await makeCarrier(b.token, "foreign");
    const sys = await makeCarrier(plat.token, "sys"); // system carrier
    const del = await makeCarrier(a.token, "del");
    await request(http).delete(`/v1/telecom/carriers/${del.carrierId}`).set(auth(a.token)).expect(204);

    await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(trunkBody("ok", own.carrierId)).expect(201);
    await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(trunkBody("sys", sys.carrierId)).expect(201);
    await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(trunkBody("foreign", foreign.carrierId)).expect(400);
    await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(trunkBody("deleted", del.carrierId)).expect(400);
    await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(trunkBody("ghost", "00000000-0000-7000-8000-000000000000")).expect(400);
  });
});

describe("tenant isolation + IDOR", () => {
  it("Tenant B cannot read / update / delete / enumerate Tenant A's trunk", async () => {
    const a = await provision("ta", TenantType.CUSTOMER, "owner");
    const b = await provision("tb", TenantType.CUSTOMER, "owner");
    const { carrierId } = await makeCarrier(a.token, "iso");
    const t = await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(trunkBody("iso", carrierId));
    const id = t.body.id;
    await request(http).get(`/v1/telecom/sip-trunks/${id}`).set(auth(b.token)).expect(404);
    await request(http).patch(`/v1/telecom/sip-trunks/${id}`).set(auth(b.token)).send({ status: "ACTIVE" }).expect(404);
    await request(http).delete(`/v1/telecom/sip-trunks/${id}`).set(auth(b.token)).expect(404);
    const list = await request(http).get("/v1/telecom/sip-trunks").set(auth(b.token));
    expect(list.body.items.some((x: { id: string }) => x.id === id)).toBe(false);
  });
});

describe("credential security", () => {
  it("keeps the secret out of responses/lists/audit; enforces ownership + type", async () => {
    const a = await provision("ta", TenantType.CUSTOMER, "owner");
    const b = await provision("tb", TenantType.CUSTOMER, "owner");
    const carA = await makeCarrier(a.token, "cred");
    // Trunk with inline SIP credential → obtain a SIP_PASSWORD credentialId.
    const t = await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(trunkBody("wc", carA.carrierId, { credential: { label: "tstt-sip", hint: "u", secret: SECRET } }));
    const sipCredId = t.body.credential.id;
    expect(JSON.stringify(t.body)).not.toContain(SECRET);
    expect(JSON.stringify((await request(http).get("/v1/telecom/sip-trunks").set(auth(a.token))).body)).not.toContain(SECRET);
    const logs = await request(http).get("/v1/audit-logs").set(auth(a.token));
    expect(JSON.stringify(logs.body)).not.toContain(SECRET);

    // A can re-reference its own SIP credential.
    await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(trunkBody("reuse", carA.carrierId, { credentialId: sipCredId })).expect(201);
    // B cannot reference A's credential → 404 (IDOR-safe).
    const carB = await makeCarrier(b.token, "bcar");
    await request(http).post("/v1/telecom/sip-trunks").set(auth(b.token)).send(trunkBody("steal", carB.carrierId, { credentialId: sipCredId })).expect(404);
    // A CARRIER_API credential is type-incompatible with a SIP trunk → 400.
    const carWithApi = await makeCarrier(a.token, "apicred", { type: "CARRIER_API" });
    await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(trunkBody("wrongtype", carA.carrierId, { credentialId: carWithApi.credId })).expect(400);
    // A soft-deleted credential is rejected.
    await prisma.telecomCredential.update({ where: { id: sipCredId }, data: { deletedAt: new Date() } });
    await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(trunkBody("deadcred", carA.carrierId, { credentialId: sipCredId })).expect(404);
  });
});

describe("validation, SSRF/CRLF input, mass-assignment, health, pagination", () => {
  it("rejects hostile and invalid input", async () => {
    const a = await provision("ta", TenantType.CUSTOMER, "owner");
    const { carrierId } = await makeCarrier(a.token, "val");
    const bad = (extra: Record<string, unknown>) => request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(trunkBody("bad", carrierId, extra));
    await bad({ port: 70000 }).expect(400);
    await bad({ host: "evil.com\r\nInjected: 1" }).expect(400); // CRLF/header injection
    await bad({ host: "bad host!" }).expect(400); // whitespace/invalid
    await bad({ sipUri: "http://evil.example" }).expect(400); // wrong scheme
    await bad({ sipUri: "sip:1.2.3.4\r\nEvil: x" }).expect(400); // CRLF in URI
    await bad({ transport: "SCTP" }).expect(400);
    await bad({ direction: "SIDEWAYS" }).expect(400);
    await bad({ maxCps: -1 }).expect(400);
    await bad({ dtmfMode: "magic" }).expect(400);
    await bad({ credentialId: "not-a-uuid" }).expect(400);
    await bad({ credentialId: "11111111-1111-7111-8111-111111111111", credential: { label: "x", secret: "y" } }).expect(400);
    await request(http).get("/v1/telecom/sip-trunks/not-a-uuid").set(auth(a.token)).expect(400);
  });

  it("ignores client-supplied ownership fields (mass assignment)", async () => {
    const a = await provision("ta", TenantType.CUSTOMER, "owner");
    const { carrierId } = await makeCarrier(a.token, "mass");
    const res = await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send({ ...trunkBody("mass", carrierId), tenantId: "00000000-0000-7000-8000-000000000000", scope: "SYSTEM", deletedAt: new Date().toISOString() });
    expect(res.status).toBe(201);
    // The trunk is owned by A and readable by A (proves tenantId was not overridden).
    await request(http).get(`/v1/telecom/sip-trunks/${res.body.id}`).set(auth(a.token)).expect(200);
  });

  it("reports honest UNKNOWN health and paginates", async () => {
    const a = await provision("ta", TenantType.CUSTOMER, "owner");
    const { carrierId } = await makeCarrier(a.token, "pg");
    for (let i = 0; i < 3; i++) await request(http).post("/v1/telecom/sip-trunks").set(auth(a.token)).send(trunkBody(`pg${i}`, carrierId));
    const first = await request(http).get("/v1/telecom/sip-trunks?limit=2").set(auth(a.token));
    expect(first.body.items.length).toBe(2);
    expect(first.body.items[0].health.status).toBe("UNKNOWN");
    expect(first.body.nextCursor).toBeTruthy();
    const next = await request(http).get(`/v1/telecom/sip-trunks?limit=2&cursor=${first.body.nextCursor}`).set(auth(a.token));
    const firstIds = new Set(first.body.items.map((x: { id: string }) => x.id));
    expect(next.body.items.every((x: { id: string }) => !firstIds.has(x.id))).toBe(true);
  });
});
