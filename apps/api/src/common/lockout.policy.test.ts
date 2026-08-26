import { describe, expect, it } from "vitest";
import { lockoutSeconds } from "./lockout.policy";

describe("lockoutSeconds (progressive brute-force policy)", () => {
  it("does not lock below 5 failures", () => {
    expect(lockoutSeconds(0)).toBe(0);
    expect(lockoutSeconds(4)).toBe(0);
  });

  it("escalates progressively", () => {
    expect(lockoutSeconds(5)).toBe(60);
    expect(lockoutSeconds(7)).toBe(60);
    expect(lockoutSeconds(8)).toBe(300);
    expect(lockoutSeconds(10)).toBe(900);
    expect(lockoutSeconds(14)).toBe(900);
  });

  it("caps at one hour", () => {
    expect(lockoutSeconds(15)).toBe(3600);
    expect(lockoutSeconds(1000)).toBe(3600);
  });
});
