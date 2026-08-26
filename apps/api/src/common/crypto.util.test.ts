import { describe, expect, it } from "vitest";
import { decryptSecret, digestEquals, encryptSecret, randomToken, sha256 } from "./crypto.util";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("crypto utils", () => {
  it("generates unique high-entropy tokens", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it("hashes deterministically and compares in constant time", () => {
    const t = randomToken();
    expect(sha256(t)).toEqual(sha256(t));
    expect(digestEquals(sha256(t), sha256(t))).toBe(true);
    expect(digestEquals(sha256(t), sha256("other"))).toBe(false);
  });

  it("round-trips AES-256-GCM secrets", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const enc = encryptSecret(secret, KEY);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc, KEY)).toEqual(secret);
  });

  it("rejects tampered ciphertext", () => {
    const enc = encryptSecret("value", KEY);
    const [iv, ct, tag] = enc.split(".");
    const tampered = `${iv}.${ct.slice(0, -2)}AA.${tag}`;
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });
});
