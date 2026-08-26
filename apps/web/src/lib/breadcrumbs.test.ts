import { describe, expect, it } from "vitest";
import { breadcrumbsForPath } from "./breadcrumbs";

describe("breadcrumbsForPath", () => {
  it("maps the root to Operations", () => {
    expect(breadcrumbsForPath("/")).toEqual([{ label: "Operations", href: "/", current: true }]);
  });

  it("maps a top-level module path", () => {
    expect(breadcrumbsForPath("/numbers")).toEqual([{ label: "Numbers", href: "/numbers", current: true }]);
  });

  it("derives nested crumbs under a module", () => {
    expect(breadcrumbsForPath("/numbers/abc-123")).toEqual([
      { label: "Numbers", href: "/numbers", current: false },
      { label: "abc-123", href: "/numbers/abc-123", current: true },
    ]);
  });

  it("handles unknown paths without throwing", () => {
    expect(breadcrumbsForPath("/nope")[0]).toMatchObject({ label: "Not found", current: true });
  });
});
