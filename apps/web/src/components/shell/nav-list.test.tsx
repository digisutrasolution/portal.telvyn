import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider, type SessionLoader } from "@/lib/session/session-context";
import { NavList } from "./nav-list";

vi.mock("next/navigation", () => ({ usePathname: () => "/numbers" }));

function ctx(permissions: string[], tenantType: "PLATFORM" | "CUSTOMER" = "CUSTOMER") {
  return { userId: "u", tenantId: "t", tenantType, roles: [], permissions };
}

function renderNav(permissions: string[], tenantType: "PLATFORM" | "CUSTOMER" = "CUSTOMER") {
  const loader: SessionLoader = async () => ctx(permissions, tenantType);
  return render(
    <SessionProvider loader={loader}>
      <TooltipProvider>
        <NavList />
      </TooltipProvider>
    </SessionProvider>,
  );
}

describe("NavList", () => {
  it("renders the nav items the session can access", async () => {
    renderNav(["did.read", "carrier.read", "sip_trunk.read", "routing.read", "wallet.read", "cdr.read", "member.read"]);
    for (const label of ["Operations", "Numbers", "Porting", "Carriers", "SIP trunks", "Routing", "LCR", "Billing", "CDRs", "Admin"]) {
      expect(await screen.findByRole("link", { name: label })).toHaveAttribute("href");
    }
  });

  it("hides items the session lacks permission for (keeps the unguarded landing)", async () => {
    renderNav(["did.read"]); // numbers + porting only
    expect(await screen.findByRole("link", { name: "Numbers" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Operations" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Porting" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Billing" })).toBeNull();
    expect(screen.queryByRole("link", { name: "CDRs" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  });

  it("marks the active module with aria-current", async () => {
    renderNav(["did.read", "wallet.read", "cdr.read", "member.read"]);
    expect(await screen.findByRole("link", { name: "Numbers" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Billing" })).not.toHaveAttribute("aria-current");
  });

  it("hides the platform-only Infrastructure item for a non-platform session", async () => {
    renderNav(["did.read", "telecom.read"], "CUSTOMER"); // has telecom.read but not platform
    expect(await screen.findByRole("link", { name: "Numbers" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Infrastructure" })).toBeNull();
  });

  it("shows Infrastructure for a platform session with telecom.read", async () => {
    renderNav(["telecom.read"], "PLATFORM");
    expect(await screen.findByRole("link", { name: "Infrastructure" })).toHaveAttribute("href", "/infrastructure");
  });
});
