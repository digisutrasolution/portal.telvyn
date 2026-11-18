import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { RouteGuard } from "./route-guard";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

function ctx(permissions: string[]) {
  return { userId: "u", tenantId: "t", tenantType: "CUSTOMER" as const, roles: [], permissions };
}

function renderGuard(path: string, permissions: string[]) {
  pathname.current = path;
  const loader: SessionLoader = async () => ctx(permissions);
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
});
