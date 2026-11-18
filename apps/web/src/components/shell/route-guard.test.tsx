import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { RouteGuard } from "./route-guard";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

function ctx(permissions: string[], tenantType: "PLATFORM" | "CUSTOMER" = "CUSTOMER") {
  return { userId: "u", tenantId: "t", tenantType, roles: [], permissions };
}

function renderGuard(path: string, permissions: string[], tenantType: "PLATFORM" | "CUSTOMER" = "CUSTOMER") {
  pathname.current = path;
  const loader: SessionLoader = async () => ctx(permissions, tenantType);
  return render(
    <SessionProvider loader={loader}>
      <RouteGuard>
        <div>MODULE CONTENT</div>
      </RouteGuard>
    </SessionProvider>,
  );
}

describe("RouteGuard", () => {
  it("renders the page on an unguarded route", async () => {
    renderGuard("/", []);
    expect(await screen.findByText("MODULE CONTENT")).toBeInTheDocument();
  });

  it("renders the page when the session holds the required permission", async () => {
    renderGuard("/numbers", ["did.read"]);
    expect(await screen.findByText("MODULE CONTENT")).toBeInTheDocument();
  });

  it("blocks with an access-restricted notice when the permission is missing", async () => {
    renderGuard("/billing", ["did.read"]); // /billing needs wallet.read
    expect(await screen.findByText("Access restricted")).toBeInTheDocument();
    expect(screen.queryByText("MODULE CONTENT")).toBeNull();
  });

  it("blocks a platform-only route for a non-platform session even with the permission", async () => {
    renderGuard("/infrastructure", ["telecom.read"], "CUSTOMER");
    expect(await screen.findByText("Access restricted")).toBeInTheDocument();
    expect(screen.queryByText("MODULE CONTENT")).toBeNull();
  });

  it("allows a platform-only route for a platform session with the permission", async () => {
    renderGuard("/infrastructure", ["telecom.read"], "PLATFORM");
    expect(await screen.findByText("MODULE CONTENT")).toBeInTheDocument();
  });
});
