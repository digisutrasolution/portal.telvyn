import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Me } from "@/lib/contracts";

vi.mock("@/lib/auth/auth-actions", () => ({
  getMe: vi.fn(),
  enrollMfa: vi.fn(),
  enableMfa: vi.fn(),
  disableMfa: vi.fn(),
}));

import { disableMfa, enableMfa, enrollMfa, getMe } from "@/lib/auth/auth-actions";
import { MfaSettings } from "./mfa-settings";

function me(overrides: Partial<Me> = {}): Me {
  return { id: "u", email: "a@b.co", fullName: null, mfaEnabled: false, emailVerified: true, ...overrides };
}

afterEach(() => vi.clearAllMocks());

describe("MfaSettings", () => {
  it("shows the off state and the set-up action when MFA is disabled", async () => {
    vi.mocked(getMe).mockResolvedValue(me({ mfaEnabled: false }));
    render(<MfaSettings />);
    expect(await screen.findByText(/Off —/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up two-factor" })).toBeInTheDocument();
  });

  it("shows the on state and the turn-off action when MFA is enabled", async () => {
    vi.mocked(getMe).mockResolvedValue(me({ mfaEnabled: true }));
    render(<MfaSettings />);
    expect(await screen.findByText(/On —/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn off two-factor" })).toBeInTheDocument();
  });

  it("enrolls, surfaces the setup key, enables with a code, then reveals recovery codes", async () => {
    vi.mocked(getMe).mockResolvedValue(me({ mfaEnabled: false }));
    vi.mocked(enrollMfa).mockResolvedValue({ otpauthUri: "otpauth://totp/Telvyn:a@b.co?secret=JBSWY3DPEHPK3PXP&issuer=Telvyn" });
    vi.mocked(enableMfa).mockResolvedValue({ recoveryCodes: ["code-1", "code-2", "code-3"] });
    render(<MfaSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Set up two-factor" }));

    const keyField = (await screen.findByLabelText("Setup key")) as HTMLInputElement;
    expect(keyField.value).toBe("JBSWY3DPEHPK3PXP");

    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));

    await waitFor(() => expect(enableMfa).toHaveBeenCalledWith("123456"));
    expect(await screen.findByText("code-1")).toBeInTheDocument();
    expect(screen.getByText("code-3")).toBeInTheDocument();
    expect(screen.getByText(/Two-factor authentication is on/i)).toBeInTheDocument();
  });

  it("rejects a non-6-digit code without calling the API", async () => {
    vi.mocked(getMe).mockResolvedValue(me({ mfaEnabled: false }));
    vi.mocked(enrollMfa).mockResolvedValue({ otpauthUri: "otpauth://totp/x?secret=ABC" });
    render(<MfaSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Set up two-factor" }));
    await screen.findByLabelText("6-digit code");
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));

    expect(await screen.findByText("Enter the 6-digit code from your authenticator app.")).toBeInTheDocument();
    expect(enableMfa).not.toHaveBeenCalled();
  });

  it("disables MFA with a step-up password and code", async () => {
    vi.mocked(getMe).mockResolvedValue(me({ mfaEnabled: true }));
    vi.mocked(disableMfa).mockResolvedValue(undefined);
    render(<MfaSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Turn off two-factor" }));

    fireEvent.change(await screen.findByLabelText("Current password"), { target: { value: "my-password" } });
    fireEvent.change(screen.getByLabelText("Authenticator or recovery code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(disableMfa).toHaveBeenCalledWith("my-password", "654321"));
  });

  it("renders an error state when the identity load fails", async () => {
    vi.mocked(getMe).mockRejectedValue(new Error("boom"));
    render(<MfaSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load/i);
  });
});
