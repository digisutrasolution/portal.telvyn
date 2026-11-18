import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InfraTabs } from "./infra-tabs";

const pathname = vi.hoisted(() => ({ current: "/infrastructure" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

function renderAt(path: string) {
  pathname.current = path;
  return render(<InfraTabs />);
}

describe("InfraTabs", () => {
  it("marks Engines active on the section root", () => {
    renderAt("/infrastructure");
    expect(screen.getByRole("link", { name: "Engines" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Nodes" })).not.toHaveAttribute("aria-current");
  });

  it("keeps Engines active on an engine detail route", () => {
    renderAt("/infrastructure/11111111-1111-1111-1111-111111111111");
    expect(screen.getByRole("link", { name: "Engines" })).toHaveAttribute("aria-current", "page");
  });

  it("marks Nodes active on the nodes route", () => {
    renderAt("/infrastructure/nodes");
    expect(screen.getByRole("link", { name: "Nodes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Engines" })).not.toHaveAttribute("aria-current");
  });

  it("marks Regions active on the regions route", () => {
    renderAt("/infrastructure/regions");
    expect(screen.getByRole("link", { name: "Regions" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Engines" })).not.toHaveAttribute("aria-current");
  });
});
