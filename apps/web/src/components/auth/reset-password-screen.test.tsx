import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";

vi.mock("@/lib/auth/auth-actions", () => ({
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
}));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

import { confirmPasswordReset, requestPasswordReset } from "@/lib/auth/auth-actions";
import { ResetPasswordScreen } from "./reset-password-screen";

afterEach(() => vi.clearAllMocks());

describe("ResetPasswordScreen — request mode (no token)", () => {
  it("requests a reset link and shows a non-enumerating confirmation", async () => {
    vi.mocked(requestPasswordReset).mockResolvedValue(undefined);
    render(<ResetPasswordScreen />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith("a@b.co"));
    await waitFor(() => expect(screen.getByText("Check your email")).toBeInTheDocument());
    expect(screen.getByText(/if an account exists/i)).toBeInTheDocument();
  });
});

describe("ResetPasswordScreen — confirm mode (token)", () => {
  it("rejects a password shorter than 12 characters without calling the API", async () => {
    render(<ResetPasswordScreen token="reset-tok" />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 12 characters/i);
    expect(confirmPasswordReset).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords without calling the API", async () => {
    render(<ResetPasswordScreen token="reset-tok" />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a-strong-password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "a-different-one" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/don't match/i);
    expect(confirmPasswordReset).not.toHaveBeenCalled();
  });

  it("confirms a valid new password and shows success", async () => {
    vi.mocked(confirmPasswordReset).mockResolvedValue(undefined);
    render(<ResetPasswordScreen token="reset-tok" />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a-strong-password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "a-strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(confirmPasswordReset).toHaveBeenCalledWith("reset-tok", "a-strong-password"));
    await waitFor(() => expect(screen.getByText("Password updated")).toBeInTheDocument());
  });

  it("surfaces an API error (e.g. an expired token)", async () => {
    vi.mocked(confirmPasswordReset).mockRejectedValue(new ApiError({ title: "Invalid or expired token", status: 400 }));
    render(<ResetPasswordScreen token="reset-tok" />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a-strong-password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "a-strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid or expired token"));
  });
});
