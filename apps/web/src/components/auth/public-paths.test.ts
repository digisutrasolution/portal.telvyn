import { describe, expect, it } from "vitest";
import { PUBLIC_AUTH_PATHS, isPublicAuthPath } from "./public-paths";

describe("isPublicAuthPath", () => {
  it("is true for the token-bearing public routes", () => {
    expect(isPublicAuthPath("/reset-password")).toBe(true);
    expect(isPublicAuthPath("/verify-email")).toBe(true);
  });

  it("is false for app routes and the root", () => {
    expect(isPublicAuthPath("/")).toBe(false);
    expect(isPublicAuthPath("/numbers")).toBe(false);
    expect(isPublicAuthPath("/reset-password/extra")).toBe(false);
  });

  it("is false for null/undefined/empty", () => {
    expect(isPublicAuthPath(null)).toBe(false);
    expect(isPublicAuthPath(undefined)).toBe(false);
    expect(isPublicAuthPath("")).toBe(false);
  });

  it("exposes exactly the two public routes", () => {
    expect([...PUBLIC_AUTH_PATHS].sort()).toEqual(["/reset-password", "/verify-email"]);
  });
});
