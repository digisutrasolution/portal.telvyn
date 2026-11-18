import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Me } from "@/lib/contracts";

vi.mock("@/lib/auth/auth-actions", () => ({ getMe: vi.fn(), requestEmailVerification: vi.fn() }));

import { getMe, requestEmailVerification } from "@/lib/auth/auth-actions";
import { EmailVerificationBanner } from "./email-verification-banner";

function me(overrides: Partial<Me> = {}): Me {
  return { id: "u", email: "a@b.co", fullName: null, mfaEnabled: false, emailVerified: false, ...overrides };
}

afterEach(() => vi.clearAllMocks());

describe("EmailVerificationBanner", () => {
  it("shows the nudge and resends when the email is unverified", async () => {
    vi.mocked(getMe).mockResolvedValue(me());
    vi.mocked(requestEmailVerification).mockResolvedValue(undefined);
    render(<EmailVerificationBanner />);

    expect(await screen.findByText(/isn't verified yet/i)).toBeInTheDocument();
    expect(screen.getByText("a@b.co")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resend email" }));
    await waitFor(() => expect(requestEmailVerification).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/verification email sent/i)).toBeInTheDocument());
  });

  it("renders nothing when the email is already verified", async () => {
    vi.mocked(getMe).mockResolvedValue(me({ emailVerified: true }));
    const { container } = render(<EmailVerificationBanner />);
    // give the fetch a tick; nothing should appear
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.queryByText(/isn't verified yet/i)).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("can be dismissed for the session", async () => {
    vi.mocked(getMe).mockResolvedValue(me());
    render(<EmailVerificationBanner />);
    expect(await screen.findByText(/isn't verified yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/isn't verified yet/i)).toBeNull();
  });

  it("renders nothing on a fetch error", async () => {
    vi.mocked(getMe).mockRejectedValue(new Error("boom"));
    const { container } = render(<EmailVerificationBanner />);
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
