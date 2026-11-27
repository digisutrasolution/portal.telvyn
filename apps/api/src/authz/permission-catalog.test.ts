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

  it("cdr.read is catalogued in billing and granted to the wallet.read holders", () => {
    const cdr = PERMISSIONS.find((p) => p.key === "cdr.read");
    expect(cdr).toBeDefined();
    expect(cdr!.group).toBe("billing");
    // CDRs are gated on cdr.read (not wallet.read); the roles that can see billing
    // today (owner via "*", operator, auditor) must also hold cdr.read.
    for (const key of ["owner", "operator", "auditor"]) {
      const role = SYSTEM_ROLES.find((r) => r.key === key)!;
      expect(expandGrants(role.permissions)).toContain("cdr.read");
    }
  });
});

import { RETIRED_PERMISSION_KEYS, WILDCARD_EXCLUDED_KEYS } from "./permission-catalog";

describe("financial authorization catalog rules (Phase 13-2B S1, BA-08)", () => {
  it("wallet.credit is retired and can never reappear in the catalog or any system role", () => {
    expect(RETIRED_PERMISSION_KEYS).toContain("wallet.credit");
    for (const k of RETIRED_PERMISSION_KEYS) {
      expect(ALL_PERMISSION_KEYS).not.toContain(k);
      for (const role of SYSTEM_ROLES) expect(expandGrants(role.permissions)).not.toContain(k);
    }
  });
  it("billing.account.provision (S5) is catalogued, wildcard-excluded and covered by no wildcard", () => {
    expect(WILDCARD_EXCLUDED_KEYS.has("billing.account.provision")).toBe(true);
    expect(expandGrants(["*"])).not.toContain("billing.account.provision");
    expect(expandGrants(["billing.*"])).not.toContain("billing.account.provision");
  });
  it("the excluded set is exactly the catalog flag (single source of truth)", () => {
    expect([...WILDCARD_EXCLUDED_KEYS].sort()).toEqual(PERMISSIONS.filter((p) => p.wildcardExcluded).map((p) => p.key).sort());
  });
  it("no system role is auto-granted a wildcard-excluded key, explicitly or by wildcard", () => {
    for (const role of SYSTEM_ROLES) {
      for (const k of WILDCARD_EXCLUDED_KEYS) {
        expect(role.permissions).not.toContain(k);
        expect(expandGrants(role.permissions)).not.toContain(k);
      }
    }
  });
});
