import { describe, expect, it } from "vitest";
import { PERMISSIONS, SYSTEM_ROLES, PERMISSION_GROUPS, ALL_PERMISSION_KEYS } from "./permission-catalog";
import { expandGrants } from "./authorization";

describe("permission catalog integrity", () => {
  it("has unique permission keys of shape resource.action", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PERMISSIONS) expect(p.key).toBe(`${p.resource}.${p.action}`);
  });

  it("references only real groups", () => {
    const groups = new Set(PERMISSION_GROUPS.map((g) => g.key));
    for (const p of PERMISSIONS) expect(groups.has(p.group)).toBe(true);
  });

  it("every system role expands to real permission keys only", () => {
    for (const role of SYSTEM_ROLES) {
      const expanded = expandGrants(role.permissions);
      expect(expanded.length).toBeGreaterThan(0);
      for (const key of expanded) expect(ALL_PERMISSION_KEYS).toContain(key);
    }
  });

  it("owner is a superset of every other system role", () => {
    const owner = new Set(expandGrants(["*"]));
    for (const role of SYSTEM_ROLES) {
      for (const key of expandGrants(role.permissions)) expect(owner.has(key)).toBe(true);
    }
  });

  it("auditor holds no mutating permission", () => {
    const auditor = expandGrants(SYSTEM_ROLES.find((r) => r.key === "auditor")!.permissions);
    expect(auditor.some((k) => k.endsWith(".manage") || k.endsWith(".credit") || k.endsWith(".assign") || k.endsWith(".invite"))).toBe(false);
  });
});
