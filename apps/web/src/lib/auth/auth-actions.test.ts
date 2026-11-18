import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", () => ({ api: { post: vi.fn(), get: vi.fn() } }));

import { api } from "@/lib/api/client";
import {
  confirmEmailVerification,
  confirmPasswordReset,
  isMfaRequired,
  login,
  logout,
  refresh,
  requestEmailVerification,
  requestPasswordReset,
  verifyMfa,
} from "./auth-actions";

const post = vi.mocked(api.post);

afterEach(() => vi.clearAllMocks());

describe("auth-actions", () => {
  it("login posts credentials unauthenticated", async () => {
    post.mockResolvedValue({ accessToken: "a", expiresIn: 900 });
    await login("x@y.z", "pw");
    expect(post).toHaveBeenCalledWith("/v1/auth/login", { email: "x@y.z", password: "pw" }, { auth: false, signal: undefined });
  });

  it("verifyMfa posts the token + code unauthenticated", async () => {
    post.mockResolvedValue({ accessToken: "a", expiresIn: 900 });
    await verifyMfa("mt", "123456");
    expect(post).toHaveBeenCalledWith("/v1/auth/mfa/verify", { mfaToken: "mt", code: "123456" }, { auth: false, signal: undefined });
  });

  it("refresh posts to /v1/auth/refresh unauthenticated", async () => {
    post.mockResolvedValue({ accessToken: "a", expiresIn: 900 });
    await refresh();
    expect(post).toHaveBeenCalledWith("/v1/auth/refresh", undefined, { auth: false, signal: undefined });
  });

  it("logout posts authenticated (default auth)", async () => {
    post.mockResolvedValue(undefined);
    await logout();
    expect(post).toHaveBeenCalledWith("/v1/auth/logout", undefined, { signal: undefined });
  });

  it("isMfaRequired narrows the login-result union", () => {
    expect(isMfaRequired({ mfaRequired: true, mfaToken: "t" })).toBe(true);
    expect(isMfaRequired({ accessToken: "a", expiresIn: 900 })).toBe(false);
  });

  it("requestPasswordReset posts the email unauthenticated", async () => {
    post.mockResolvedValue(undefined);
    await requestPasswordReset("x@y.z");
    expect(post).toHaveBeenCalledWith("/v1/auth/password-reset/request", { email: "x@y.z" }, { auth: false, signal: undefined });
  });

  it("confirmPasswordReset posts the token + new password unauthenticated", async () => {
    post.mockResolvedValue(undefined);
    await confirmPasswordReset("tok", "a-strong-password");
    expect(post).toHaveBeenCalledWith(
      "/v1/auth/password-reset/confirm",
      { token: "tok", newPassword: "a-strong-password" },
      { auth: false, signal: undefined },
    );
  });

  it("requestEmailVerification posts authenticated (no body)", async () => {
    post.mockResolvedValue(undefined);
    await requestEmailVerification();
    expect(post).toHaveBeenCalledWith("/v1/auth/email-verification/request", undefined, { signal: undefined });
  });

  it("confirmEmailVerification posts the token unauthenticated", async () => {
    post.mockResolvedValue(undefined);
    await confirmEmailVerification("tok");
    expect(post).toHaveBeenCalledWith("/v1/auth/email-verification/confirm", { token: "tok" }, { auth: false, signal: undefined });
  });
});
