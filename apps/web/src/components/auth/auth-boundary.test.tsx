import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/problem";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { AuthBoundary } from "./auth-boundary";

function ctx() {
  return {
    userId: "u",
    tenantId: "t",
    tenantType: "PLATFORM" as const,
    roles: [],
    permissions: [],
  };
}

function renderBoundary(loader: SessionLoader) {
  return render(
    <SessionProvider loader={loader}>
      <AuthBoundary>
        <div>SECRET APP</div>
      </AuthBoundary>
    </SessionProvider>,
  );
}

describe("AuthBoundary", () => {
  it("renders the app when authenticated", async () => {
    renderBoundary(async () => ctx());
    await waitFor(() => expect(screen.getByText("SECRET APP")).toBeInTheDocument());
  });

  it("shows the sign-in screen (and hides the app) when unauthenticated", async () => {
    renderBoundary(async () => {
      throw new ApiError({ title: "Unauthorized", status: 401 });
    });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument());
    expect(screen.queryByText("SECRET APP")).toBeNull();
  });

  it("shows a no-workspace notice on 403", async () => {
    renderBoundary(async () => {
      throw new ApiError({ title: "Forbidden", status: 403 });
    });
    await waitFor(() => expect(screen.getByText("No workspace access")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows an error notice with retry on an unexpected failure", async () => {
    renderBoundary(async () => {
      throw new Error("boom");
    });
    await waitFor(() => expect(screen.getByText("Can't reach the server")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows a loading notice while the session resolves", () => {
    renderBoundary(() => new Promise<never>(() => {})); // never resolves
    expect(screen.getByText("Loading your session…")).toBeInTheDocument();
    expect(screen.queryByText("SECRET APP")).toBeNull();
  });
});
