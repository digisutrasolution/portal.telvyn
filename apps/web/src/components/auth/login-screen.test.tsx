import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { LoginScreen } from "./login-screen";

vi.mock("@/lib/auth/auth-actions", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/auth-actions")>();
  return { ...actual, login: vi.fn(), verifyMfa: vi.fn() };
});
vi.mock("@/lib/api/token-store", () => ({
  getAccessToken: vi.fn(() => null),
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
}));

import { login, verifyMfa } from "@/lib/auth/auth-actions";
import { setAccessToken } from "@/lib/api/token-store";

// The provider wrapper keeps useSession working; its loader stays unauthenticated
// so it never interferes with what we assert on the login form itself.
const idleLoader: SessionLoader = async () => {
  throw new ApiError({ title: "Unauthorized", status: 401 });
};

function renderLogin() {
  return render(
    <SessionProvider loader={idleLoader}>
      <LoginScreen />
    </SessionProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe("LoginScreen", () => {
  it("submits credentials and stores the access token on success", async () => {
    vi.mocked(login).mockResolvedValue({ accessToken: "tok-ok", expiresIn: 900 });
    renderLogin();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("a@b.co", "pw"));
    await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith("tok-ok"));
  });

  it("advances to the MFA step and verifies the code", async () => {
    vi.mocked(login).mockResolvedValue({ mfaRequired: true, mfaToken: "mt-123" });
    vi.mocked(verifyMfa).mockResolvedValue({ accessToken: "tok-mfa", expiresIn: 900 });
    renderLogin();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Two-factor code" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Authentication code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(verifyMfa).toHaveBeenCalledWith("mt-123", "654321"));
    await waitFor(() => expect(setAccessToken).toHaveBeenCalledWith("tok-mfa"));
  });

  it("shows the problem title on a failed login and does not store a token", async () => {
    vi.mocked(login).mockRejectedValue(new ApiError({ title: "Invalid credentials", status: 401 }));
    renderLogin();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Invalid credentials"));
    expect(setAccessToken).not.toHaveBeenCalled();
  });
});
