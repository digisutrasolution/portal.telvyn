/**
 * Phase 13-2B S5 — provisioning contract (pure; no database).
 * Owner decisions O3 (account number), O5 (idempotency key + fingerprint),
 * O6 (typed audit metadata). Database behaviour is covered by
 * test/billing-account-provisioning.e2e.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_NUMBER_ALPHABET,
  ACCOUNT_NUMBER_PATTERN,
  ACCOUNT_NUMBER_SUFFIX_PATTERN,
  generateAccountNumberSuffix,
  isValidIdempotencyKey,
  provisioningFingerprint,
  ProvisionBillingAccountDto,
  PROVISIONING_FINGERPRINT_PATTERN,
} from "./billing-account-provisioning.contract";

const U = "0190a1b2-c3d4-7e5f-8a9b-0000000000a1";
const P = "0190a1b2-c3d4-7e5f-8a9b-0000000000a2";
const T = "0190a1b2-c3d4-7e5f-8a9b-0000000000a3";
const G = "0190a1b2-c3d4-7e5f-8a9b-0000000000a4";
const base = { actorUserId: U, actorTenantId: P, targetTenantId: T, currency: "USD" as const, label: "Main", isDefault: false };

describe("account number (O3)", () => {
  it("uses an unambiguous uppercase alphabet (no 0/1/I/L/O/U)", () => {
    expect(ACCOUNT_NUMBER_ALPHABET).toHaveLength(30);
    expect(new Set(ACCOUNT_NUMBER_ALPHABET).size).toBe(30);
    for (const c of "01ILOU") expect(ACCOUNT_NUMBER_ALPHABET).not.toContain(c);
    expect(ACCOUNT_NUMBER_ALPHABET).toBe(ACCOUNT_NUMBER_ALPHABET.toUpperCase());
  });

  it("generates 12-character suffixes from the alphabet, covering all of it, without repeats", () => {
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const s = generateAccountNumberSuffix();
      expect(s).toMatch(ACCOUNT_NUMBER_SUFFIX_PATTERN);
      seen.add(s);
      for (const c of s) chars.add(c);
    }
    expect(seen.size).toBe(2000);
    expect(chars.size).toBe(30);
  });

  it("the full pattern is BA-YYYY-XXXXXXXXXXXX with no check digit", () => {
    expect(`BA-2026-${generateAccountNumberSuffix()}`).toMatch(ACCOUNT_NUMBER_PATTERN);
    expect("BA-2026-ABCDEFGH234").not.toMatch(ACCOUNT_NUMBER_PATTERN);
    expect("BA-2026-ABCDEFGH23456").not.toMatch(ACCOUNT_NUMBER_PATTERN);
    expect("BA-26-ABCDEFGH2345").not.toMatch(ACCOUNT_NUMBER_PATTERN);
    expect("ba-2026-abcdefgh2345").not.toMatch(ACCOUNT_NUMBER_PATTERN);
  });
});

describe("idempotency key (O5)", () => {
  it("accepts 16–128 characters of [A-Za-z0-9-_.:] only", () => {
    expect(isValidIdempotencyKey("a".repeat(16))).toBe(true);
    expect(isValidIdempotencyKey("a".repeat(128))).toBe(true);
    expect(isValidIdempotencyKey("Ab09-_.:Ab09-_.:")).toBe(true);
    for (const bad of ["a".repeat(15), "a".repeat(129), "a".repeat(15) + " ", "a".repeat(15) + "/", "ä".repeat(16), "", undefined, 42]) {
      expect(isValidIdempotencyKey(bad)).toBe(false);
    }
  });
});

describe("request fingerprint (O5)", () => {
  it("is versioned, deterministic and case-normalizes ids", () => {
    const f = provisioningFingerprint(base);
    expect(f).toMatch(PROVISIONING_FINGERPRINT_PATTERN);
    expect(provisioningFingerprint({ ...base })).toBe(f);
    expect(provisioningFingerprint({ ...base, targetTenantId: T.toUpperCase() })).toBe(f);
  });

  it("changes with every bound parameter (operation scope is fixed in the canonical form)", () => {
    const f = provisioningFingerprint(base);
    const variants = [
      { actorUserId: "0190a1b2-c3d4-7e5f-8a9b-0000000000b1" },
      { actorTenantId: "0190a1b2-c3d4-7e5f-8a9b-0000000000b2" },
      { targetTenantId: "0190a1b2-c3d4-7e5f-8a9b-0000000000b3" },
      { currency: "EUR" as const },
      { label: "Main " },
      { isDefault: true },
    ];
    for (const v of variants) expect(provisioningFingerprint({ ...base, ...v })).not.toBe(f);
  });
});

describe("request DTO", () => {
  const ok = { targetTenantId: T, currency: "USD", label: "  Main  ", stepUpGrantId: G };

  it("trims the label and defaults isDefault=false, mode=PREPAID", () => {
    const v = ProvisionBillingAccountDto.parse(ok);
    expect(v).toEqual({ targetTenantId: T, currency: "USD", label: "Main", isDefault: false, mode: "PREPAID", stepUpGrantId: G });
  });

  it("refuses POSTPAID, unknown fields, client-chosen numbers/balances and malformed values", () => {
    for (const bad of [
      { ...ok, mode: "POSTPAID" },
      { ...ok, accountNumber: "BA-2026-ABCDEFGH2345" },
      { ...ok, openingBalance: 0 },
      { ...ok, tenantId: T },
      { ...ok, label: "" },
      { ...ok, label: "a".repeat(101) },
      { ...ok, label: "bad\u0007label" },
      { ...ok, currency: "XXX" },
      { ...ok, targetTenantId: "nope" },
      { ...ok, stepUpGrantId: undefined },
    ]) {
      expect(ProvisionBillingAccountDto.safeParse(bad).success).toBe(false);
    }
  });
});
