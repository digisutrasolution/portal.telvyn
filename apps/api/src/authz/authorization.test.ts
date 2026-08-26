import { describe, expect, it } from "vitest";
import { grantCovers, isAuthorized, expandGrants } from "./authorization";

describe("grantCovers", () => {
  it("matches exact, resource-wildcard, and global grants", () => {
    expect(grantCovers("did.read", "did.read")).toBe(true);
    expect(grantCovers("did.*", "did.assign")).toBe(true);
    expect(grantCovers("*", "wallet.credit")).toBe(true);
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
