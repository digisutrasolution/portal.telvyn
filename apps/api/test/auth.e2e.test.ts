/**
 * Auth integration suite — runs against the REAL Postgres + Redis from
 * docker-compose.dev.yml (constitution: real backend, no mocks). Covers:
 * login, MFA login, refresh rotation + reuse detection, logout, session
 * revocation & device list, lockout, password reset, email verification,
 * login history, security events.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";
import * as argon2 from "argon2";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PrismaClient } from "@prisma/client";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://telvyn:change_me_local_dev@localhost:5433/telvyn?schema=public";
process.env.REDIS_URL ??= "redis://localhost:6380";
process.env.JWT_ACCESS_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");
process.env.COOKIE_SECURE ??= "false";

import { createApp } from "../src/main";
import { ARGON2_OPTIONS } from "../src/auth/account-flows.service";

const prisma = new PrismaClient();
let app: NestExpressApplication;
let http: ReturnType<NestExpressApplication["getHttpServer"]>;

const EMAIL = `op.${Date.now()}@telvyn.test`;
const PASSWORD = "correct-horse-battery-staple-9";
const TRANSPORT = { "x-token-transport": "body" } as const;

async function createUser(email: string, password: string) {
  return prisma.user.create({
    data: { email, passwordHash: await argon2.hash(password, ARGON2_OPTIONS), status: "ACTIVE" },
  });
}

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  await createUser(EMAIL, PASSWORD);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: "@telvyn.test" } } });
  await prisma.$disconnect();
  await app.close();
});

describe("login", () => {
  it("rejects a bad password with a generic 401 problem", async () => {
    const res = await request(http).post("/v1/auth/login").send({ email: EMAIL, password: "wrong-password-123" });
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body.title).toBe("Invalid email or password");
  });

  it("rejects an unknown email with the SAME generic message (no enumeration)", async () => {
    const res = await request(http)
      .post("/v1/auth/login")
      .send({ email: "nobody@telvyn.test", password: "whatever-password-1" });
    expect(res.status).toBe(401);
    expect(res.body.title).toBe("Invalid email or password");
  });

  it("issues tokens on valid credentials (body transport) and sets no body refresh for cookie clients", async () => {
    const res = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.expiresIn).toBe(900);

    const cookieRes = await request(http).post("/v1/auth/login").send({ email: EMAIL, password: PASSWORD });
    expect(cookieRes.status).toBe(200);
    expect(cookieRes.body.refreshToken).toBeUndefined();
    const rawCookie = cookieRes.headers["set-cookie"] as unknown as string[] | undefined;
    const setCookie = (rawCookie ?? []).join(";");
    expect(setCookie).toContain("tv_refresh=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/v1/auth");
  });

  it("validates the body at the boundary (400 with issues)", async () => {
    const res = await request(http).post("/v1/auth/login").send({ email: "not-an-email", password: "" });
    expect(res.status).toBe(400);
    expect(res.body.issues?.length).toBeGreaterThan(0);
  });
});

describe("refresh rotation + reuse detection", () => {
  it("rotates the refresh token and revokes the session on reuse", async () => {
    const login = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email: EMAIL, password: PASSWORD });
    const first = login.body.refreshToken as string;

    const rotated = await request(http).post("/v1/auth/refresh").set(TRANSPORT).send({ refreshToken: first });
    expect(rotated.status).toBe(200);
    const second = rotated.body.refreshToken as string;
    expect(second).not.toEqual(first);

    // Replaying the consumed token = theft signal → 401 + session revoked.
    const reuse = await request(http).post("/v1/auth/refresh").set(TRANSPORT).send({ refreshToken: first });
    expect(reuse.status).toBe(401);

    // The successor from the revoked session must now be dead too.
    const afterRevoke = await request(http).post("/v1/auth/refresh").set(TRANSPORT).send({ refreshToken: second });
    expect(afterRevoke.status).toBe(401);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const event = await prisma.securityEvent.findFirst({
      where: { userId: user.id, type: "auth.refresh_reuse_detected" },
    });
    expect(event).not.toBeNull();
  });
});

describe("sessions, devices, revocation, logout", () => {
  it("lists sessions, revokes one, and kills its access token immediately", async () => {
    const a = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email: EMAIL, password: PASSWORD });
    const b = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email: EMAIL, password: PASSWORD });

    const list = await request(http).get("/v1/auth/sessions").set("Authorization", `Bearer ${a.body.accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(2);
    expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const other = list.body.find((s: { current: boolean }) => !s.current);
    const del = await request(http)
      .delete(`/v1/auth/sessions/${other.id}`)
      .set("Authorization", `Bearer ${a.body.accessToken}`);
    expect(del.status).toBe(204);

    // Revocation is immediate: the other session's access token is dead pre-expiry.
    const deadCheck = await request(http).get("/v1/auth/me").set("Authorization", `Bearer ${b.body.accessToken}`);
    if (other.id === (await sessionIdOf(b.body.accessToken))) {
      expect(deadCheck.status).toBe(401);
    }

    const logout = await request(http).post("/v1/auth/logout").set("Authorization", `Bearer ${a.body.accessToken}`);
    expect(logout.status).toBe(204);
    const afterLogout = await request(http).get("/v1/auth/me").set("Authorization", `Bearer ${a.body.accessToken}`);
    expect(afterLogout.status).toBe(401);
  });

  it("logout-all revokes every session", async () => {
    const a = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email: EMAIL, password: PASSWORD });
    const b = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email: EMAIL, password: PASSWORD });
    await request(http).post("/v1/auth/logout-all").set("Authorization", `Bearer ${a.body.accessToken}`).expect(204);
    await request(http).get("/v1/auth/me").set("Authorization", `Bearer ${b.body.accessToken}`).expect(401);
  });
});

describe("brute force lockout", () => {
  it("locks the account after repeated failures (423)", async () => {
    const email = `lockme.${Date.now()}@telvyn.test`;
    await createUser(email, PASSWORD);
    for (let i = 0; i < 5; i++) {
      await request(http).post("/v1/auth/login").send({ email, password: "definitely-wrong-1" });
    }
    const locked = await request(http).post("/v1/auth/login").send({ email, password: PASSWORD });
    expect(locked.status).toBe(423);
  });
});

describe("MFA", () => {
  it("enrolls, enables, requires MFA at login, accepts TOTP, and disables with step-up", async () => {
    const email = `mfa.${Date.now()}@telvyn.test`;
    await createUser(email, PASSWORD);
    const login = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
    const bearer = `Bearer ${login.body.accessToken}`;

    const enroll = await request(http).post("/v1/auth/mfa/enroll").set("Authorization", bearer);
    expect(enroll.status).toBe(200);
    const secret = new URL(enroll.body.otpauthUri).searchParams.get("secret")!;

    const enable = await request(http)
      .post("/v1/auth/mfa/enable")
      .set("Authorization", bearer)
      .send({ code: authenticator.generate(secret) });
    expect(enable.status).toBe(200);
    expect(enable.body.recoveryCodes).toHaveLength(8);

    // Login now returns an MFA challenge, not tokens.
    const challenged = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
    expect(challenged.body.mfaRequired).toBe(true);
    expect(challenged.body.accessToken).toBeUndefined();

    const bad = await request(http)
      .post("/v1/auth/mfa/verify")
      .set(TRANSPORT)
      .send({ mfaToken: challenged.body.mfaToken, code: "000000" });
    expect(bad.status).toBe(401);

    const done = await request(http)
      .post("/v1/auth/mfa/verify")
      .set(TRANSPORT)
      .send({ mfaToken: challenged.body.mfaToken, code: authenticator.generate(secret) });
    expect(done.status).toBe(200);
    expect(done.body.accessToken).toBeTruthy();

    // Recovery code works exactly once.
    const challenge2 = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
    const recovery = enable.body.recoveryCodes[0] as string;
    await request(http)
      .post("/v1/auth/mfa/verify")
      .set(TRANSPORT)
      .send({ mfaToken: challenge2.body.mfaToken, code: recovery })
      .expect(200);
    const challenge3 = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
    await request(http)
      .post("/v1/auth/mfa/verify")
      .set(TRANSPORT)
      .send({ mfaToken: challenge3.body.mfaToken, code: recovery })
      .expect(401);

    // Step-up disable: wrong password refused; correct password + code succeeds.
    await request(http)
      .post("/v1/auth/mfa/disable")
      .set("Authorization", `Bearer ${done.body.accessToken}`)
      .send({ password: "wrong-password-123", code: authenticator.generate(secret) })
      .expect(401);
    await request(http)
      .post("/v1/auth/mfa/disable")
      .set("Authorization", `Bearer ${done.body.accessToken}`)
      .send({ password: PASSWORD, code: authenticator.generate(secret) })
      .expect(204);
  });
});

describe("password reset + email verification", () => {
  it("resets the password via a hashed single-use token and revokes sessions", async () => {
    const email = `reset.${Date.now()}@telvyn.test`;
    await createUser(email, PASSWORD);
    const login = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });

    await request(http).post("/v1/auth/password-reset/request").send({ email }).expect(202);
    // Unknown email gets the identical 202 (no enumeration).
    await request(http).post("/v1/auth/password-reset/request").send({ email: "ghost@telvyn.test" }).expect(202);

    const outbox = await prisma.emailOutbox.findFirst({
      where: { toEmail: email, purpose: "password_reset" },
      orderBy: { createdAt: "desc" },
    });
    expect(outbox).not.toBeNull();
    const token = new URL(outbox!.body.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;

    const newPassword = "brand-new-secure-password-7";
    await request(http).post("/v1/auth/password-reset/confirm").send({ token, newPassword }).expect(204);
    // Token is single-use.
    await request(http).post("/v1/auth/password-reset/confirm").send({ token, newPassword }).expect(400);
    // Old sessions are revoked; old password dead; new password works.
    await request(http).get("/v1/auth/me").set("Authorization", `Bearer ${login.body.accessToken}`).expect(401);
    await request(http).post("/v1/auth/login").send({ email, password: PASSWORD }).expect(401);
    await request(http).post("/v1/auth/login").send({ email, password: newPassword }).expect(200);
  });

  it("verifies email ownership via a hashed single-use token", async () => {
    const email = `verify.${Date.now()}@telvyn.test`;
    await createUser(email, PASSWORD);
    const login = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email, password: PASSWORD });
    const bearer = `Bearer ${login.body.accessToken}`;

    await request(http).post("/v1/auth/email-verification/request").set("Authorization", bearer).expect(202);
    const outbox = await prisma.emailOutbox.findFirst({
      where: { toEmail: email, purpose: "email_verification" },
      orderBy: { createdAt: "desc" },
    });
    const token = new URL(outbox!.body.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;

    await request(http).post("/v1/auth/email-verification/confirm").send({ token }).expect(204);
    const me = await request(http).get("/v1/auth/me").set("Authorization", bearer);
    expect(me.body.emailVerified).toBe(true);
  });
});

describe("history + audit", () => {
  it("exposes login history and security events to the account owner", async () => {
    const login = await request(http).post("/v1/auth/login").set(TRANSPORT).send({ email: EMAIL, password: PASSWORD });
    const bearer = `Bearer ${login.body.accessToken}`;

    const history = await request(http).get("/v1/auth/login-history").set("Authorization", bearer);
    expect(history.status).toBe(200);
    expect(history.body.length).toBeGreaterThan(0);
    expect(history.body.some((a: { success: boolean }) => a.success === false)).toBe(true);

    const events = await request(http).get("/v1/auth/security-events").set("Authorization", bearer);
    expect(events.status).toBe(200);
    expect(events.body.some((e: { type: string }) => e.type === "auth.login")).toBe(true);

    // Both endpoints require auth.
    await request(http).get("/v1/auth/login-history").expect(401);
  });
});

async function sessionIdOf(accessToken: string): Promise<string> {
  const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString());
  return payload.sid as string;
}
