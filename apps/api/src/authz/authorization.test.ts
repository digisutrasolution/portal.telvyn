import { describe, expect, it } from "vitest";
import { grantCovers, isAuthorized, expandGrants } from "./authorization";

describe("grantCovers", () => {
  it("matches exact, resource-wildcard, and global grants", () => {
    expect(grantCovers("did.read", "did.read")).toBe(true);
    expect(grantCovers("did.*", "did.assign")).toBe(true);
    expect(grantCovers("*", "wallet.read")).toBe(true);
  });
  it("does not over-match", () => {
    expect(grantCovers("did.read", "did.assign")).toBe(false);
    expect(grantCovers("did.*", "wallet.read")).toBe(false);
    // A wildcard prefix must not leak across a resource boundary.
    expect(grantCovers("did.*", "didx.read")).toBe(false);
  });
});

describe("isAuthorized (deny-by-default)", () => {
  it("denies when grants are empty", () => {
    expect(isAuthorized([], ["did.read"])).toBe(false);
  });
  it("requires ALL required permissions", () => {
    expect(isAuthorized(["did.read"], ["did.read", "did.assign"])).toBe(false);
    expect(isAuthorized(["did.*"], ["did.read", "did.assign"])).toBe(true);
  });
  it("treats no-requirements as allowed", () => {
    expect(isAuthorized([], [])).toBe(true);
  });
});

describe("expandGrants", () => {
  it("expands wildcards to concrete catalog keys", () => {
    const expanded = expandGrants(["did.*"]);
    expect(expanded).toContain("did.read");
    expect(expanded).toContain("did.assign");
    expect(expanded).not.toContain("wallet.read");
  });
  it("expands the global grant to the full catalog", () => {
    expect(expandGrants(["*"]).length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// Phase 13-2B S1 — wildcard exclusion, MFA-for-finance and fail-closed
// assignment (ADR-0022 Amendment 5 BA-08; owner decisions G3/G4). No catalogued
// key is flagged yet (the first is named in S5), so these tests inject an
// excluded set — the production default is the catalog-derived set.
// ---------------------------------------------------------------------------
import {
  assertNoWildcardExcludedAssignment,
  effectivePermissions,
  WildcardExcludedAssignmentError,
} from "./authorization";

const FIN = "billing_account.provision"; // synthetic high-risk key (test catalog only)
const EXCL: ReadonlySet<string> = new Set([FIN]);
const CATALOG = ["billing_account.read", FIN, "did.read"];

describe("wildcard exclusion (BA-08)", () => {
  it("global and resource wildcards never cover a wildcard-excluded key", () => {
    expect(grantCovers("*", FIN, EXCL)).toBe(false);
    expect(grantCovers("billing_account.*", FIN, EXCL)).toBe(false);
    // ...while still covering the non-excluded siblings (no collateral denial)
    expect(grantCovers("billing_account.*", "billing_account.read", EXCL)).toBe(true);
    expect(grantCovers("*", "did.read", EXCL)).toBe(true);
  });
  it("only an exact, explicit grant satisfies a wildcard-excluded key", () => {
    expect(grantCovers(FIN, FIN, EXCL)).toBe(true);
    expect(isAuthorized(["*"], [FIN], EXCL)).toBe(false);
    expect(isAuthorized(["*", FIN], [FIN], EXCL)).toBe(true);
  });
  it("wildcard expansion (seed + runtime) never materializes a wildcard-excluded key", () => {
    expect(expandGrants(["*"], CATALOG, EXCL)).toEqual(["billing_account.read", "did.read"]);
    expect(expandGrants(["billing_account.*"], CATALOG, EXCL)).toEqual(["billing_account.read"]);
    expect(expandGrants([FIN], CATALOG, EXCL)).toEqual([FIN]); // explicit is kept (assignment is policed)
  });
  it("an unrelated prefix or near-miss key is not treated as excluded", () => {
    expect(grantCovers("*", "billing_account.provisionx", EXCL)).toBe(true);
  });
});

describe("MFA-for-finance (BA-08)", () => {
  it("drops wildcard-excluded keys from the effective set when MFA is not enabled", () => {
    expect([...effectivePermissions([FIN, "did.read"], false, EXCL)]).toEqual(["did.read"]);
  });
  it("keeps them when MFA is enabled; never affects ordinary keys", () => {
    expect([...effectivePermissions([FIN, "did.read"], true, EXCL)].sort()).toEqual(["billing_account.provision", "did.read"]);
    expect([...effectivePermissions(["did.read"], false, EXCL)]).toEqual(["did.read"]);
  });
  it("a non-MFA holder of an explicit high-risk grant is denied end-to-end", () => {
    expect(isAuthorized(effectivePermissions([FIN], false, EXCL), [FIN], EXCL)).toBe(false);
  });
});

describe("fail-closed assignment in S1 (owner decision G4)", () => {
  it("refuses any assignment conferring a wildcard-excluded key", () => {
    expect(() => assertNoWildcardExcludedAssignment(["did.read", FIN, FIN], EXCL)).toThrow(WildcardExcludedAssignmentError);
    let caught: unknown;
    try {
      assertNoWildcardExcludedAssignment([FIN, FIN], EXCL);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WildcardExcludedAssignmentError);
    expect((caught as WildcardExcludedAssignmentError).keys).toEqual([FIN]); // de-duplicated
  });
  it("allows ordinary assignments (no regression for existing roles)", () => {
    expect(() => assertNoWildcardExcludedAssignment(["did.read", "member.manage"], EXCL)).not.toThrow();
    expect(() => assertNoWildcardExcludedAssignment([], EXCL)).not.toThrow();
  });
});
