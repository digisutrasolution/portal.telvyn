import { afterEach, describe, expect, it } from "vitest";
import { clearAccessToken, getAccessToken, setAccessToken } from "./token-store";

afterEach(() => clearAccessToken());

describe("token-store", () => {
  it("starts empty", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("stores and returns the access token", () => {
    setAccessToken("abc.def.ghi");
    expect(getAccessToken()).toBe("abc.def.ghi");
  });

  it("clears the token", () => {
    setAccessToken("abc.def.ghi");
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });

  it("setAccessToken(null) clears it too", () => {
    setAccessToken("x");
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });
});
