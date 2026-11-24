import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12E — Carrier foundation e2e (real Postgres + Redis). Proves:
 * dual-nature scope (system/tenant), tenant isolation + IDOR, system-carrier
 * protection, no scope escalation, credential-secret secrecy (response / audit /
 * cross-tenant / system), validation, RBAC, and pagination.
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
const SECRET = "super-secret-sip-pw-DO-NOT-LEAK-9f3a"; // must never appear in any response/audit

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
const carrierBody = (name: string, extra: Record<string, unknown> = {}) => ({ name: `tstc-${name}`, type: "BIDIRECTIONAL", ...extra });
const withCred = (label: string) => ({ credential: { type: "SIP_PASSWORD", label: `tstc-${label}`, hint: "user1", secret: SECRET } });

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flushRateLimits);
afterAll(async () => {
  await prisma.carrier.deleteMany({ where: { name: { startsWith: "tstc-" } } });
  await prisma.telecomCredential.deleteMany({ where: { label: { startsWith: "tstc-" } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: { in: ["ca", "cb", "cplat", "cop"] } } });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("RBAC + basic CRUD", () => {
  it("rejects unauthenticated access (401)", async () => {
    await request(http).get("/v1/telecom/carriers").expect(401);
  });

  it("an operator (carrier.read only) can read but not create (403)", async () => {
    const op = await provision("cop", TenantType.CUSTOMER, "operator");
    await request(http).get("/v1/telecom/carriers").set(auth(op.token)).expect(200);
    await request(http).post("/v1/telecom/carriers").set(auth(op.token)).send(carrierBody("x")).expect(403);
  });

  it("creates, reads, updates and soft-deletes a tenant carrier", async () => {
    const a = await provision("ca", TenantType.CUSTOMER, "owner");
    const created = await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send(carrierBody("crud", { priority: 50 }));
    expect(created.status).toBe(201);
    expect(created.body.scope).toBe("TENANT");
    const id = created.body.id;
    await request(http).get(`/v1/telecom/carriers/${id}`).set(auth(a.token)).expect(200);
    const upd = await request(http).patch(`/v1/telecom/carriers/${id}`).set(auth(a.token)).send({ status: "ACTIVE", priority: 10 });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe("ACTIVE");
    await request(http).delete(`/v1/telecom/carriers/${id}`).set(auth(a.token)).expect(204);
    await request(http).get(`/v1/telecom/carriers/${id}`).set(auth(a.token)).expect(404);
  });
});

describe("tenant isolation + IDOR", () => {
  it("Tenant B cannot read / update / delete / enumerate Tenant A's carrier", async () => {
    const a = await provision("ca", TenantType.CUSTOMER, "owner");
    const b = await provision("cb", TenantType.CUSTOMER, "owner");
    const c = await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send(carrierBody("iso"));
    const id = c.body.id;

    await request(http).get(`/v1/telecom/carriers/${id}`).set(auth(b.token)).expect(404);
    await request(http).patch(`/v1/telecom/carriers/${id}`).set(auth(b.token)).send({ status: "ACTIVE" }).expect(404);
    await request(http).delete(`/v1/telecom/carriers/${id}`).set(auth(b.token)).expect(404);
    const list = await request(http).get("/v1/telecom/carriers?scope=tenant").set(auth(b.token));
    expect(list.body.items.some((x: { id: string }) => x.id === id)).toBe(false);
    // A's carrier is untouched.
    expect((await request(http).get(`/v1/telecom/carriers/${id}`).set(auth(a.token))).status).toBe(200);
  });
});

describe("system-scope security", () => {
  it("platform creates a system carrier; a tenant may read but not mutate it, and cannot escalate its own", async () => {
    const plat = await provision("cplat", TenantType.PLATFORM, "owner");
    const a = await provision("ca", TenantType.CUSTOMER, "owner");
    const sys = await request(http).post("/v1/telecom/carriers").set(auth(plat.token)).send(carrierBody("sys"));
    expect(sys.body.scope).toBe("SYSTEM");
    const sysId = sys.body.id;

    // Tenant sees the system carrier (read scope includes system)...
    expect((await request(http).get(`/v1/telecom/carriers/${sysId}`).set(auth(a.token))).status).toBe(200);
    // ...but cannot modify or delete it.
    await request(http).patch(`/v1/telecom/carriers/${sysId}`).set(auth(a.token)).send({ status: "ACTIVE" }).expect(403);
    await request(http).delete(`/v1/telecom/carriers/${sysId}`).set(auth(a.token)).expect(403);

    // No scope escalation: client-supplied tenantId/scope are ignored (Zod strips them).
    const own = await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send({ ...carrierBody("esc"), tenantId: null, scope: "SYSTEM", system: true });
    expect(own.body.scope).toBe("TENANT");
    const escalated = await request(http).patch(`/v1/telecom/carriers/${own.body.id}`).set(auth(a.token)).send({ tenantId: null, scope: "SYSTEM" });
    expect(escalated.body.scope).toBe("TENANT");
  });
});

describe("credential vault security (ADR-0009)", () => {
  it("never exposes the secret; rejects cross-tenant and system credential attachment", async () => {
    const a = await provision("ca", TenantType.CUSTOMER, "owner");
    const b = await provision("cb", TenantType.CUSTOMER, "owner");
    const plat = await provision("cplat", TenantType.PLATFORM, "owner");

    // A creates a carrier with an inline credential.
    const withCredRes = await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send(carrierBody("cred", withCred("a")));
    expect(withCredRes.status).toBe(201);
    expect(withCredRes.body.credential.id).toBeTruthy();
    expect(withCredRes.body.credential.hint).toBe("user1");
    // Secret appears NOWHERE in the response.
    expect(JSON.stringify(withCredRes.body)).not.toContain(SECRET);
    const aCredId = withCredRes.body.credential.id;

    // Fetch + list also never leak the secret.
    expect(JSON.stringify((await request(http).get(`/v1/telecom/carriers/${withCredRes.body.id}`).set(auth(a.token))).body)).not.toContain(SECRET);
    expect(JSON.stringify((await request(http).get("/v1/telecom/carriers").set(auth(a.token))).body)).not.toContain(SECRET);

    // Audit log records the credentialId reference but never the secret.
    const logs = await request(http).get("/v1/audit-logs").set(auth(a.token));
    expect(logs.body.some((l: { action: string }) => l.action === "telecom.carrier.created")).toBe(true);
    expect(JSON.stringify(logs.body)).not.toContain(SECRET);

    // Tenant B cannot attach A's credential (cross-tenant) → 404 (IDOR-safe).
    await request(http).post("/v1/telecom/carriers").set(auth(b.token)).send(carrierBody("steal", { credentialId: aCredId })).expect(404);

    // Platform creates a system credential; a tenant cannot attach it → 403.
    const sysCarrier = await request(http).post("/v1/telecom/carriers").set(auth(plat.token)).send(carrierBody("syscred", withCred("sys")));
    const sysCredId = sysCarrier.body.credential.id;
    await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send(carrierBody("borrow", { credentialId: sysCredId })).expect(403);

    // A can attach its OWN credential by reference.
    await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send(carrierBody("reuse", { credentialId: aCredId })).expect(201);
  });
});

describe("validation + honest health + pagination", () => {
  it("rejects invalid input", async () => {
    const a = await provision("ca", TenantType.CUSTOMER, "owner");
    await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send(carrierBody("neg", { maxCps: -5 })).expect(400);
    await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send({ ...carrierBody("bad"), status: "NOPE" }).expect(400);
    await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send({ ...carrierBody("both"), credentialId: "11111111-1111-7111-8111-111111111111", ...withCred("both") }).expect(400);
    await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send(carrierBody("badregion", { regionId: "00000000-0000-7000-8000-000000000000" })).expect(400);
    await request(http).get("/v1/telecom/carriers/not-a-uuid").set(auth(a.token)).expect(400);
  });

  it("reports honest UNKNOWN health and paginates deterministically", async () => {
    const a = await provision("ca", TenantType.CUSTOMER, "owner");
    for (let i = 0; i < 3; i++) await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send(carrierBody(`pg${i}`));
    const first = await request(http).get("/v1/telecom/carriers?scope=tenant&limit=2").set(auth(a.token));
    expect(first.body.items.length).toBe(2);
    expect(first.body.items[0].health.status).toBe("UNKNOWN");
    expect(first.body.nextCursor).toBeTruthy();
    const next = await request(http).get(`/v1/telecom/carriers?scope=tenant&limit=2&cursor=${first.body.nextCursor}`).set(auth(a.token));
    // No overlap between pages.
    const firstIds = new Set(first.body.items.map((x: { id: string }) => x.id));
    expect(next.body.items.every((x: { id: string }) => !firstIds.has(x.id))).toBe(true);
  });
});

describe("operator health probe (Phase 12O-2aw)", () => {
  it("probes an honest posture (no fabricated HEALTHY) and the carrier health then reflects the probe", async () => {
    const a = await provision("ca", TenantType.CUSTOMER, "owner");
    const created = await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send(carrierBody("probe", { status: "ACTIVE" })).expect(201);
    const id = created.body.id as string;

    // Before any probe → honest "not yet probed".
    const before = await request(http).get(`/v1/telecom/carriers/${id}`).set(auth(a.token)).expect(200);
    expect(before.body.health).toEqual({ status: "UNKNOWN", detail: "not yet probed" });

    // No SIP endpoint configured → UNCONFIGURED → UNKNOWN, never HEALTHY.
    const probe = await request(http).post(`/v1/telecom/carriers/${id}/health-check`).set(auth(a.token)).expect(200);
    expect(probe.body).toMatchObject({ carrierId: id, status: "UNKNOWN", reachability: "UNCONFIGURED" });
    expect(probe.body.correlationId).toBeTruthy();

    // The carrier health is now derived from the recorded event (not the unprobed literal).
    const after = await request(http).get(`/v1/telecom/carriers/${id}`).set(auth(a.token)).expect(200);
    expect(after.body.health).toEqual({ status: "UNKNOWN", detail: "last operator health probe" });
  });

  it("maps an administratively DISABLED carrier to DISABLED", async () => {
    const a = await provision("ca", TenantType.CUSTOMER, "owner");
    const created = await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send(carrierBody("dis", { status: "DISABLED" })).expect(201);
    const id = created.body.id as string;
    const probe = await request(http).post(`/v1/telecom/carriers/${id}/health-check`).set(auth(a.token)).expect(200);
    expect(probe.body).toMatchObject({ status: "DISABLED", reachability: "DISABLED" });
    const after = await request(http).get(`/v1/telecom/carriers/${id}`).set(auth(a.token)).expect(200);
    expect(after.body.health.status).toBe("DISABLED");
  });

  it("404s probing a foreign/unknown carrier (scope-resolved, IDOR-safe)", async () => {
    const a = await provision("ca", TenantType.CUSTOMER, "owner");
    await request(http).post("/v1/telecom/carriers/00000000-0000-7000-8000-000000000000/health-check").set(auth(a.token)).expect(404);
  });
});

describe("health-event history (Phase 12O-2ax)", () => {
  it("reads back the transitions a probe records (newest first), and is empty before any probe", async () => {
    const a = await provision("ca", TenantType.CUSTOMER, "owner");
    const created = await request(http).post("/v1/telecom/carriers").set(auth(a.token)).send(carrierBody("hist", { status: "ACTIVE" })).expect(201);
    const id = created.body.id as string;

    const before = await request(http).get(`/v1/telecom/carriers/${id}/health-events`).set(auth(a.token)).expect(200);
    expect(before.body.items).toEqual([]);
    expect(before.body.nextCursor).toBeNull();

    await request(http).post(`/v1/telecom/carriers/${id}/health-check`).set(auth(a.token)).expect(200);
    const after = await request(http).get(`/v1/telecom/carriers/${id}/health-events`).set(auth(a.token)).expect(200);
    expect(after.body.items.length).toBe(1);
    expect(after.body.items[0]).toMatchObject({ fromStatus: null, toStatus: "UNKNOWN" });
    // Safe view: never echoes the entity/tenant linkage.
    expect(after.body.items[0]).not.toHaveProperty("entityType");
    expect(after.body.items[0]).not.toHaveProperty("tenantId");
  });

  it("404s on history for a foreign/unknown carrier (scope-resolved, IDOR-safe)", async () => {
    const a = await provision("ca", TenantType.CUSTOMER, "owner");
    await request(http).get("/v1/telecom/carriers/00000000-0000-7000-8000-000000000000/health-events").set(auth(a.token)).expect(404);
  });
});
