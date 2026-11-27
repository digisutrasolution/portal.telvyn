import "./e2e-guard"; // INC-DB-001B: two-stage target guard — must stay the FIRST import
import { RUN_EMAIL_SUFFIX, ownedTenantWhere, ownedUserWhere, resetRunRateLimits, runPrefix } from "./e2e-run";
import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12H — Routing profile foundation e2e (real Postgres + Redis).
 * Declarative config only — NOTHING executed. Proves: CRUD, tenant isolation +
 * IDOR, RBAC, mass-assignment, destination validation per type (incl. SSRF-safe
 * webhooks + CRLF), priority/retry/timeout/schedule/timezone validation,
 * foreign carrier/trunk rejection, deterministic ordering, soft delete,
 * duplicate name, audit, pagination.
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
const TST = runPrefix("tstr");

const prisma = fixturePrisma;
const redis = new Redis(process.env.REDIS_URL!);
let app: NestExpressApplication;
let http: ReturnType<NestExpressApplication["getHttpServer"]>;
const PASSWORD = "correct-horse-battery-staple-9";
const TRANSPORT = { "x-token-transport": "body" } as const;
let seq = 0;
const pname = (n: string) => `${TST}${n}-${Date.now()}-${seq++}`;

async function flushRateLimits(): Promise<void> {
  await resetRunRateLimits(redis);
}
async function systemRole(key: string): Promise<string> {
  return (await prisma.role.findFirstOrThrow({ where: { tenantId: null, key } })).id;
}
async function provision(tag: string, roleKey: string): Promise<{ token: string; tenantId: string }> {
  const email = `${tag}.${Date.now()}.${Math.round(performance.now())}${RUN_EMAIL_SUFFIX}`;
  const user = await prisma.user.create({ data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE" } });
  const tenant = await prisma.tenant.create({ data: { slug: `${tag}-${user.id}`, name: tag, type: TenantType.CUSTOMER } });
  const membership = await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } });
  await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: await systemRole(roleKey) } });
  await prisma.user.update({ where: { id: user.id }, data: { tenantId: tenant.id } });
  const res = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
  return { token: res.body.accessToken, tenantId: tenant.id };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function makeCarrier(token: string, name: string): Promise<string> {
  return (await request(http).post("/v1/telecom/carriers").set(auth(token)).send({ name: `${TST}${name}` })).body.id;
}
async function makeTrunk(token: string, name: string, carrierId: string): Promise<string> {
  return (await request(http).post("/v1/telecom/sip-trunks").set(auth(token)).send({ name: `${TST}${name}`, carrierId })).body.id;
}
const post = (token: string, body: object) => request(http).post("/v1/telecom/routing-profiles").set(auth(token)).send(body);

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flushRateLimits);
afterAll(async () => {
  // Resolve run-owned tenants BEFORE their owning users are deleted.
  const ownedTenants = await ownedTenantWhere(prisma, ["ra", "rb", "rop"]);
  await prisma.routingProfile.deleteMany({ where: { name: { startsWith: TST } } });
  await prisma.sipTrunk.deleteMany({ where: { name: { startsWith: TST } } });
  await prisma.carrier.deleteMany({ where: { name: { startsWith: TST } } });
  await prisma.user.deleteMany({ where: ownedUserWhere() });
  await prisma.tenant.deleteMany({ where: ownedTenants });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("RBAC + CRUD + ordering", () => {
  it("rejects unauthenticated access (401)", async () => {
    await request(http).get("/v1/telecom/routing-profiles").expect(401);
  });

  it("operator (routing.read, no routing.manage) reads but cannot create (403)", async () => {
    const op = await provision("rop", "operator");
    await request(http).get("/v1/telecom/routing-profiles").set(auth(op.token)).expect(200);
    await post(op.token, { name: pname("x") }).expect(403);
  });

  it("owner CRUDs a profile; rules come back in deterministic priority order", async () => {
    const a = await provision("ra", "owner");
    const created = await post(a.token, {
      name: pname("crud"),
      direction: "INBOUND",
      rules: [
        { destinationType: "PHONE_NUMBER", destination: "+91 98765 43210", priority: 30 },
        { destinationType: "EXTENSION", destination: "1001", priority: 10 },
        { destinationType: "VOICEMAIL", destination: "default", priority: 20 },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.rules.map((r: { priority: number }) => r.priority)).toEqual([10, 20, 30]); // deterministic
    expect(created.body.rules[2].destination).toBe("+919876543210"); // canonical E.164 stored
    const id = created.body.id;
    await request(http).get(`/v1/telecom/routing-profiles/${id}`).set(auth(a.token)).expect(200);
    const upd = await request(http).patch(`/v1/telecom/routing-profiles/${id}`).set(auth(a.token)).send({ status: "SUSPENDED", rules: [] });
    expect(upd.body.status).toBe("SUSPENDED");
    expect(upd.body.rules).toHaveLength(0); // rules replaced
    await request(http).delete(`/v1/telecom/routing-profiles/${id}`).set(auth(a.token)).expect(204);
    await request(http).get(`/v1/telecom/routing-profiles/${id}`).set(auth(a.token)).expect(404);
  });

  it("rejects a duplicate profile name for the same tenant (409)", async () => {
    const a = await provision("ra", "owner");
    const name = pname("dup");
    await post(a.token, { name }).expect(201);
    await post(a.token, { name }).expect(409);
  });
});

describe("tenant isolation + IDOR", () => {
  it("Tenant B cannot read / update / delete / enumerate Tenant A's profile", async () => {
    const a = await provision("ra", "owner");
    const b = await provision("rb", "owner");
    const id = (await post(a.token, { name: pname("iso") })).body.id;
    await request(http).get(`/v1/telecom/routing-profiles/${id}`).set(auth(b.token)).expect(404);
    await request(http).patch(`/v1/telecom/routing-profiles/${id}`).set(auth(b.token)).send({ status: "ACTIVE" }).expect(404);
    await request(http).delete(`/v1/telecom/routing-profiles/${id}`).set(auth(b.token)).expect(404);
    const list = await request(http).get("/v1/telecom/routing-profiles").set(auth(b.token));
    expect(list.body.items.some((x: { id: string }) => x.id === id)).toBe(false);
  });
});

describe("relationship auth + valid destinations", () => {
  it("accepts own trunk/carrier + public webhook; rejects foreign trunk/carrier", async () => {
    const a = await provision("ra", "owner");
    const b = await provision("rb", "owner");
    const carA = await makeCarrier(a.token, "ca");
    const trunkA = await makeTrunk(a.token, "ta", carA);
    const carB = await makeCarrier(b.token, "cb");
    const trunkB = await makeTrunk(b.token, "tb", carB);

    await post(a.token, { name: pname("ok"), rules: [
      { destinationType: "SIP_TRUNK", destination: trunkA, priority: 10, carrierId: carA, timeoutSeconds: 30, retryCount: 2 },
      { destinationType: "WEBHOOK", destination: "https://hooks.example.com/telvyn", priority: 20 },
    ] }).expect(201);
    // Foreign trunk / carrier → 400.
    await post(a.token, { name: pname("ftrunk"), rules: [{ destinationType: "SIP_TRUNK", destination: trunkB, priority: 10 }] }).expect(400);
    await post(a.token, { name: pname("fcar"), rules: [{ destinationType: "PHONE_NUMBER", destination: "+919876543211", carrierId: carB, priority: 10 }] }).expect(400);
    // Non-owned (random) trunk id → 400.
    await post(a.token, { name: pname("ghosttrunk"), rules: [{ destinationType: "SIP_TRUNK", destination: "00000000-0000-7000-8000-000000000000", priority: 10 }] }).expect(400);
  });

  it("accepts a valid schedule + timezone", async () => {
    const a = await provision("ra", "owner");
    await post(a.token, { name: pname("sched"), rules: [
      { destinationType: "EXTENSION", destination: "2002", priority: 10, schedule: { timezone: "Asia/Kolkata", daysOfWeek: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020 } },
    ] }).expect(201);
  });
});

describe("validation: destinations, SSRF, schedule, bounds", () => {
  it("rejects malformed and hostile destinations / config", async () => {
    const a = await provision("ra", "owner");
    const bad = (rule: Record<string, unknown>) => post(a.token, { name: pname("bad"), rules: [rule] });
    await bad({ destinationType: "PHONE_NUMBER", destination: "not-a-number" }).expect(400);
    await bad({ destinationType: "EXTENSION", destination: "abc" }).expect(400);
    await bad({ destinationType: "SIP_TRUNK", destination: "not-a-uuid" }).expect(400);
    await bad({ destinationType: "VOICEMAIL", destination: "bad space" }).expect(400);
    // SSRF-hostile webhooks.
    await bad({ destinationType: "WEBHOOK", destination: "http://insecure.example" }).expect(400); // not https
    await bad({ destinationType: "WEBHOOK", destination: "https://127.0.0.1/x" }).expect(400); // loopback
    await bad({ destinationType: "WEBHOOK", destination: "https://localhost/x" }).expect(400);
    await bad({ destinationType: "WEBHOOK", destination: "https://10.0.0.5/x" }).expect(400); // private
    await bad({ destinationType: "WEBHOOK", destination: "https://169.254.1.1/x" }).expect(400); // link-local
    await bad({ destinationType: "WEBHOOK", destination: "https://good.example/x\r\nEvil: 1" }).expect(400); // CRLF
    // Bounds.
    await bad({ destinationType: "EXTENSION", destination: "1", priority: -1 }).expect(400);
    await bad({ destinationType: "EXTENSION", destination: "1", retryCount: 99 }).expect(400);
    await bad({ destinationType: "EXTENSION", destination: "1", timeoutSeconds: 99999 }).expect(400);
    // Schedule / timezone.
    await bad({ destinationType: "EXTENSION", destination: "1", schedule: { timezone: "Asia/Kolkata", daysOfWeek: [1], startMinute: 600, endMinute: 500 } }).expect(400); // start>=end
    await bad({ destinationType: "EXTENSION", destination: "1", schedule: { timezone: "Mars/Olympus", daysOfWeek: [1], startMinute: 100, endMinute: 200 } }).expect(400); // bad tz
  });
});

describe("security + audit + pagination", () => {
  it("ignores client-supplied ownership (mass assignment) and audits references only", async () => {
    const a = await provision("ra", "owner");
    const res = await post(a.token, { name: pname("mass"), tenantId: "00000000-0000-7000-8000-000000000000", scope: "SYSTEM" });
    expect(res.status).toBe(201); // unknown keys stripped on create
    await request(http).get(`/v1/telecom/routing-profiles/${res.body.id}`).set(auth(a.token)).expect(200);
    // strict update rejects unknown ownership key.
    await request(http).patch(`/v1/telecom/routing-profiles/${res.body.id}`).set(auth(a.token)).send({ tenantId: "00000000-0000-7000-8000-000000000000" }).expect(400);
    const logs = await request(http).get("/v1/audit-logs").set(auth(a.token));
    expect(logs.body.some((l: { action: string }) => l.action === "telecom.routing_profile.created")).toBe(true);
  });

  it("paginates deterministically and filters", async () => {
    const a = await provision("ra", "owner");
    for (let i = 0; i < 3; i++) await post(a.token, { name: pname(`pg${i}`) });
    const first = await request(http).get("/v1/telecom/routing-profiles?limit=2").set(auth(a.token));
    expect(first.body.items.length).toBe(2);
    expect(first.body.nextCursor).toBeTruthy();
    const next = await request(http).get(`/v1/telecom/routing-profiles?limit=2&cursor=${first.body.nextCursor}`).set(auth(a.token));
    const firstIds = new Set(first.body.items.map((x: { id: string }) => x.id));
    expect(next.body.items.every((x: { id: string }) => !firstIds.has(x.id))).toBe(true);
  });
});
