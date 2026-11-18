import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navItemForPath, requiredPermissionForPath } from "./nav";

describe("requiredPermissionForPath", () => {
  it("maps module routes (and their sub-paths) to the module permission", () => {
    expect(requiredPermissionForPath("/numbers")).toBe("did.read");
    expect(requiredPermissionForPath("/numbers/abc-123")).toBe("did.read");
    expect(requiredPermissionForPath("/porting")).toBe("did.read");
    expect(requiredPermissionForPath("/carriers")).toBe("carrier.read");
    expect(requiredPermissionForPath("/billing")).toBe("wallet.read");
    expect(requiredPermissionForPath("/cdrs")).toBe("cdr.read");
    expect(requiredPermissionForPath("/admin")).toBe("member.read");
    expect(requiredPermissionForPath("/infrastructure")).toBe("telecom.read");
  });

  it("marks the NOC infrastructure route platform-only", () => {
    expect(navItemForPath("/infrastructure")?.platform).toBe(true);
    expect(navItemForPath("/numbers")?.platform).toBeUndefined();
  });

  it("is undefined for the unguarded landing and for unknown routes", () => {
    expect(requiredPermissionForPath("/")).toBeUndefined();
    expect(requiredPermissionForPath("/nope")).toBeUndefined();
  });

  it("agrees with navItemForPath", () => {
    expect(requiredPermissionForPath("/numbers")).toBe(navItemForPath("/numbers")?.permission);
  });

  it("every declared nav permission is a non-empty string", () => {
    for (const item of NAV_ITEMS) {
      if (item.permission !== undefined) expect(item.permission.length).toBeGreaterThan(0);
    }
  });
});
