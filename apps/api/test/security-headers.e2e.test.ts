import "./e2e-guard"; // INC-DB-001B: two-stage target guard — must stay the FIRST import
import { RUN_EMAIL_SUFFIX } from "./e2e-run";
/**
 * Security-header regression suite (pre-Phase-12 hardening). Asserts the JSON
 * API emits the hardened header set on normal, auth, and error responses, and
 * that HSTS stays OFF outside production (so local HTTP dev is never pinned).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { NestExpressApplication } from "@nestjs/platform-express";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");

import { createApp } from "../src/main";

let app: NestExpressApplication;
let http: ReturnType<NestExpressApplication["getHttpServer"]>;

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

function assertHardened(headers: Record<string, string | undefined>): void {
  expect(headers["content-security-policy"]).toContain("default-src 'none'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["cross-origin-resource-policy"]).toBe("same-site");
  expect(headers["permissions-policy"]).toContain("microphone=()");
  expect(headers["x-powered-by"]).toBeUndefined();
  // HSTS must be OFF in non-production (this suite runs as NODE_ENV=test).
  expect(headers["strict-transport-security"]).toBeUndefined();
}

describe("API security headers", () => {
  it("sets hardened headers on a normal 200 response", async () => {
    const res = await request(http).get("/healthz").expect(200);
    assertHardened(res.headers);
  });

  it("sets hardened headers on an auth 401 error response", async () => {
    const res = await request(http)
      .post("/v1/auth/login")
      .send({ email: `nobody${RUN_EMAIL_SUFFIX}`, password: "definitely-wrong-1" });
    expect(res.status).toBe(401);
    assertHardened(res.headers);
  });

  it("sets hardened headers on a 404", async () => {
    const res = await request(http).get("/does-not-exist");
    expect(res.status).toBe(404);
    assertHardened(res.headers);
  });
});
