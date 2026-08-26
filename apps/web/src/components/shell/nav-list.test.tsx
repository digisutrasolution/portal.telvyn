import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavList } from "./nav-list";
import { NAV_ITEMS } from "@/lib/nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/numbers",
}));

describe("NavList", () => {
  it("renders every primary nav item with an accessible link", () => {
    render(
      <TooltipProvider>
        <NavList />
      </TooltipProvider>,
    );
    for (const item of NAV_ITEMS) {
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute("href", item.href);
    }
  });

  it("marks the active module with aria-current", () => {
    render(
      <TooltipProvider>
        <NavList />
      </TooltipProvider>,
    );
    expect(screen.getByRole("link", { name: "Numbers" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Billing" })).not.toHaveAttribute("aria-current");
  });
});
