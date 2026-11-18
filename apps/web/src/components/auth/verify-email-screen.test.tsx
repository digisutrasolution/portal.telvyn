import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";

vi.mock("@/lib/auth/auth-actions", () => ({ confirmEmailVerification: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

import { confirmEmailVerification } from "@/lib/auth/auth-actions";
import { VerifyEmailScreen } from "./verify-email-screen";

afterEach(() => vi.clearAllMocks());

describe("VerifyEmailScreen", () => {
  it("confirms the token on mount and shows success", async () => {
    vi.mocked(confirmEmailVerification).mockResolvedValue(undefined);
    render(<VerifyEmailScreen token="verify-tok" />);
    await waitFor(() => expect(confirmEmailVerification).toHaveBeenCalledWith("verify-tok", expect.anything()));
    await waitFor(() => expect(screen.getByText("Email verified")).toBeInTheDocument());
  });

  it("shows a failure message on an invalid token", async () => {
    vi.mocked(confirmEmailVerification).mockRejectedValue(new ApiError({ title: "Invalid or expired token", status: 400 }));
    render(<VerifyEmailScreen token="bad-tok" />);
    await waitFor(() => expect(screen.getByText("Verification failed")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid or expired token");
  });

  it("shows an invalid-link message with no token and never calls the API", () => {
    render(<VerifyEmailScreen />);
    expect(screen.getByText("Invalid link")).toBeInTheDocument();
    expect(confirmEmailVerification).not.toHaveBeenCalled();
  });
});
