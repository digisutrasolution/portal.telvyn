import "./e2e-guard"; // INC-DB-001B: two-stage target guard — must stay the FIRST import
import { RUN_EMAIL_SUFFIX, ownedTenantWhere, ownedUserWhere, resetRunRateLimits } from "./e2e-run";
import { fixturePrisma } from "./fixture-db";
/**
 * P1 — role-escalation correction (pre-S5 mandatory security prerequisite).
 * Real Postgres + Redis through the HTTP API. Proves that `member.manage` /
 * `role.manage` no longer confer authority beyond the actor's own permissions:
 * protected-role assignment, self-modification, demoting a more-privileged
 * member, last-owner removal, cross-tenant roles, role deletion and a
 * concurrent mutual demotion are all refused, while legitimate administration
 * keeps working.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import * as argon2 from "argon2";
import Redis from "ioredis";
import type { NestExpressApplication } from "@nestjs/platform-express";

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
let n = 0;

type Member = { token: string; membershipId: string; userId: string };

async function systemRole(key: string): Promise<string> {
  return (await prisma.role.findFirstOrThrow({ where: { tenantId: null, key } })).id;
}

/** A CUSTOMER tenant whose slug ends with a run-owned anchor user's id (run-scoped cleanup). */
async function newTenant(tag: string): Promise<string> {
  const anchor = await prisma.user.create({
    data: { email: `escalation.anchor.${Date.now()}.${++n}${RUN_EMAIL_SUFFIX}`, passwordHash: "x", status: "ACTIVE" },
  });
  return (await prisma.tenant.create({ data: { slug: `${tag}-${anchor.id}`, name: tag, type: "CUSTOMER" } })).id;
}

/** Add an ACTIVE member with the given role ids to `tenantId` and log in. */
async function member(tenantId: string, roleIds: string[]): Promise<Member> {
  const email = `escalation.${Date.now()}.${++n}${RUN_EMAIL_SUFFIX}`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await argon2.hash(PASSWORD, ARGON2_OPTIONS), status: "ACTIVE", tenantId },
  });
  const m = await prisma.membership.create({ data: { userId: user.id, tenantId, status: "ACTIVE" } });
  for (const roleId of roleIds) await prisma.membershipRole.create({ data: { membershipId: m.id, roleId } });
  const res = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, membershipId: m.id, userId: user.id };
}

const setRoles = (actor: Member, target: string, roleIds: string[]) =>
  request(http).put(`/v1/members/${target}/roles`).set("Authorization", `Bearer ${actor.token}`).send({ roleIds });

async function roleKeys(membershipId: string): Promise<string[]> {
  const rows = await prisma.membershipRole.findMany({ where: { membershipId }, select: { role: { select: { key: true } } } });
  return rows.map((r) => r.role.key).sort();
}

/** A tenant custom role holding exactly the given concrete keys (created directly). */
async function customRole(tenantId: string, keys: string[]): Promise<string> {
  const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
  expect(perms.length).toBe(keys.length);
  const role = await prisma.role.create({
    data: {
      tenantId,
      key: `custom_${++n}`,
      name: `Custom ${n}`,
      isSystem: false,
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
    },
  });
  return role.id;
}

let OWNER = "";
let ADMIN = "";
let OPERATOR = "";

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  OWNER = await systemRole("owner");
  ADMIN = await systemRole("admin");
  OPERATOR = await systemRole("operator");
});

beforeEach(() => resetRunRateLimits(redis));

afterAll(async () => {
  const ownedTenants = await ownedTenantWhere(prisma, ["escalation"]);
  await prisma.user.deleteMany({ where: ownedUserWhere() });
  await prisma.tenant.deleteMany({ where: ownedTenants });
  await prisma.$disconnect();
  await redis.quit();
  await app.close();
});

describe("P1 — protected role assignment", () => {
  it("an admin (member.manage) cannot assign the owner role (403) — roles unchanged", async () => {
    const t = await newTenant("escalation");
    await member(t, [OWNER]);
    const admin = await member(t, [ADMIN]);
    const target = await member(t, [OPERATOR]);
    const res = await setRoles(admin, target.membershipId, [OWNER]);
    expect(res.status).toBe(403);
    expect(await roleKeys(target.membershipId)).toEqual(["operator"]);
  });

  it("an admin cannot hand out a role granting permissions it lacks (operator holds wallet.read) (403)", async () => {
    const t = await newTenant("escalation");
    await member(t, [OWNER]);
    const admin = await member(t, [ADMIN]);
    const target = await member(t, []);
    expect((await setRoles(admin, target.membershipId, [OPERATOR])).status).toBe(403);
    expect(await roleKeys(target.membershipId)).toEqual([]);
  });

  it("nobody can change their own roles, not even an owner (403)", async () => {
    const t = await newTenant("escalation");
    const owner = await member(t, [OWNER]);
    const admin = await member(t, [ADMIN]);
    expect((await setRoles(admin, admin.membershipId, [OWNER])).status).toBe(403);
    expect((await setRoles(owner, owner.membershipId, [OWNER, ADMIN])).status).toBe(403);
    expect(await roleKeys(admin.membershipId)).toEqual(["admin"]);
  });

  it("an admin cannot demote or strip an owner (403)", async () => {
    const t = await newTenant("escalation");
    const owner = await member(t, [OWNER]);
    await member(t, [OWNER]); // a second owner, so last-owner protection is not what refuses it
    const admin = await member(t, [ADMIN]);
    expect((await setRoles(admin, owner.membershipId, [ADMIN])).status).toBe(403);
    expect((await setRoles(admin, owner.membershipId, [])).status).toBe(403);
    expect(await roleKeys(owner.membershipId)).toEqual(["owner"]);
  });

  it("the last active owner cannot be removed (409)", async () => {
    const t = await newTenant("escalation");
    const owner = await member(t, [OWNER]);
    // A member with every non-financial permission (custom role) — authorized to
    // modify the owner, but the tenant must keep one owner.
    const full = await prisma.permission.findMany({ select: { key: true } });
    const everything = await customRole(t, full.map((p) => p.key).filter((k) => k !== "wallet.credit" && !k.startsWith("billing.")));
    const peer = await member(t, [everything]);
    expect((await setRoles(peer, owner.membershipId, [ADMIN])).status).toBe(409);
    expect(await roleKeys(owner.membershipId)).toEqual(["owner"]);
  });

  it("another tenant's custom role cannot be assigned (409)", async () => {
    const a = await newTenant("escalation");
    const b = await newTenant("escalation");
    const ownerA = await member(a, [OWNER]);
    const target = await member(a, []);
    const foreign = await customRole(b, ["did.read"]);
    expect((await setRoles(ownerA, target.membershipId, [foreign])).status).toBe(409);
    expect(await roleKeys(target.membershipId)).toEqual([]);
  });

  it("legitimate administration keeps working: owner assigns any role; admin assigns admin and subset custom roles", async () => {
    const t = await newTenant("escalation");
    const owner = await member(t, [OWNER]);
    const second = await member(t, []);
    expect((await setRoles(owner, second.membershipId, [OWNER])).status).toBe(200);
    expect((await setRoles(owner, second.membershipId, [OPERATOR])).status).toBe(200);
    expect(await roleKeys(second.membershipId)).toEqual(["operator"]);
    const admin = await member(t, [ADMIN]);
    const target = await member(t, []);
    expect((await setRoles(admin, target.membershipId, [ADMIN])).status).toBe(200);
    const subset = await customRole(t, ["did.read", "member.read"]);
    expect((await setRoles(admin, target.membershipId, [subset])).status).toBe(200);
    expect((await setRoles(admin, target.membershipId, [])).status).toBe(200);
    // Owner demotes an owner while another owner remains.
    expect((await setRoles(owner, second.membershipId, [OWNER])).status).toBe(200);
    expect((await setRoles(owner, second.membershipId, [ADMIN])).status).toBe(200);
  });
});

describe("P1 — role deletion", () => {
  it("an admin cannot delete a custom role granting permissions it lacks (403); an owner can", async () => {
    const t = await newTenant("escalation");
    const owner = await member(t, [OWNER]);
    const admin = await member(t, [ADMIN]);
    const walletRole = await customRole(t, ["wallet.read"]);
    await request(http).delete(`/v1/roles/${walletRole}`).set("Authorization", `Bearer ${admin.token}`).expect(403);
    await request(http).delete(`/v1/roles/${walletRole}`).set("Authorization", `Bearer ${owner.token}`).expect(204);
  });
});

describe("P1 — concurrent authorization changes", () => {
  it("two owners demoting each other concurrently: exactly one succeeds and an owner remains", async () => {
    const t = await newTenant("escalation");
    const a = await member(t, [OWNER]);
    const b = await member(t, [OWNER]);
    const [ra, rb] = await Promise.all([setRoles(a, b.membershipId, [ADMIN]), setRoles(b, a.membershipId, [ADMIN])]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const owners = await prisma.membership.count({
      where: { tenantId: t, status: "ACTIVE", deletedAt: null, roles: { some: { role: { key: "owner", tenantId: null } } } },
    });
    expect(owners).toBe(1);
  });

  it("an actor demoted after its request context was built is refused (authority re-derived under the lock)", async () => {
    const t = await newTenant("escalation");
    await member(t, [OWNER]);
    const admin = await member(t, [ADMIN]);
    const target = await member(t, []);
    // Demote the admin directly (as if a concurrent request committed first).
    await prisma.membershipRole.deleteMany({ where: { membershipId: admin.membershipId } });
    expect((await setRoles(admin, target.membershipId, [ADMIN])).status).toBe(403);
    expect(await roleKeys(target.membershipId)).toEqual([]);
  });
});
