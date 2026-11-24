import { fixturePrisma } from "./fixture-db";
/**
 * Phase 12R-3 — Kill-switch e2e (real Postgres + Redis). Proves: RBAC (read vs
 * toggle), tenant toggle lifecycle + isolation, GLOBAL platform-only gating
 * (PlatformGuard), and that a toggle is audited + emits a KILL_SWITCH FraudEvent.
 * STATE only — nothing is enforced.
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
const BASE = "/v1/fraud/kill-switch";
const NAMES = ["ksa", "ksb", "ksplat", "ksaud"];

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

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});
beforeEach(flushRateLimits);
afterAll(async () => {
  // GLOBAL switch has null tenantId — clean it explicitly; tenant switches cascade.
  await prisma.killSwitch.deleteMany({ where: { scope: "GLOBAL" } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.tenant.deleteMany({ where: { name: { in: NAMES } } });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("RBAC", () => {
  it("rejects unauthenticated access (401)", async () => {
    await request(http).get(BASE).expect(401);
  });

  it("an auditor (fraud.policy.read, no fraud.killswitch) can read but not toggle (403)", async () => {
    const aud = await provision("ksaud", TenantType.CUSTOMER, "auditor");
    await request(http).get(BASE).set(auth(aud.token)).expect(200);
    await request(http).post(`${BASE}/activate`).set(auth(aud.token)).send({ reason: "x" }).expect(403);
  });
});

describe("tenant switch lifecycle + isolation + fraud event", () => {
  it("defaults inactive, activates (audited + KILL_SWITCH event), deactivates; B's switch is independent", async () => {
    const a = await provision("ksa", TenantType.CUSTOMER, "admin");
    const b = await provision("ksb", TenantType.CUSTOMER, "admin");

    // Default state is inactive.
    const before = await request(http).get(BASE).set(auth(a.token)).expect(200);
    expect(before.body).toMatchObject({ scope: "TENANT", active: false });

    const on = await request(http).post(`${BASE}/activate`).set(auth(a.token)).send({ reason: "fraud spike" }).expect(200);
    expect(on.body).toMatchObject({ scope: "TENANT", active: true, reason: "fraud spike" });
    expect(await request(http).get(BASE).set(auth(a.token)).then((r) => r.body.active)).toBe(true);

    // B's tenant switch is unaffected by A's activation.
    expect(await request(http).get(BASE).set(auth(b.token)).then((r) => r.body.active)).toBe(false);

    // The activation produced a KILL_SWITCH fraud event (admin has fraud.events.read).
    const events = await request(http).get("/v1/fraud/events?type=KILL_SWITCH&limit=50").set(auth(a.token)).expect(200);
    expect(events.body.items.some((e: { code: string }) => e.code === "KILL_SWITCH_ACTIVATED")).toBe(true);
    // ...and an audit entry.
    const logs = await request(http).get("/v1/audit-logs").set(auth(a.token)).expect(200);
    expect(logs.body.some((l: { action: string }) => l.action === "fraud.kill_switch.activated")).toBe(true);

    const off = await request(http).post(`${BASE}/deactivate`).set(auth(a.token)).send({ reason: "cleared" }).expect(200);
    expect(off.body.active).toBe(false);
  });
});

describe("global switch — platform only", () => {
  it("a non-platform tenant is forbidden; a platform operator can toggle the global switch", async () => {
    const cust = await provision("ksa", TenantType.CUSTOMER, "admin");
    const plat = await provision("ksplat", TenantType.PLATFORM, "admin");

    // A CUSTOMER tenant cannot touch the global switch (PlatformGuard).
    await request(http).get(`${BASE}/global`).set(auth(cust.token)).expect(403);
    await request(http).post(`${BASE}/global/activate`).set(auth(cust.token)).send({ reason: "x" }).expect(403);

    // The platform operator can.
    const g = await request(http).post(`${BASE}/global/activate`).set(auth(plat.token)).send({ reason: "platform incident" }).expect(200);
    expect(g.body).toMatchObject({ scope: "GLOBAL", active: true });
    expect(await request(http).get(`${BASE}/global`).set(auth(plat.token)).then((r) => r.body.active)).toBe(true);
    await request(http).post(`${BASE}/global/deactivate`).set(auth(plat.token)).send({}).expect(200);
  });
});
