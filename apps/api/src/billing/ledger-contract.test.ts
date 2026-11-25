import { describe, it, expect } from "vitest";
import { Currency } from "@prisma/client";
import { microsFromBigInt } from "./money";
import { LedgerError } from "./ledger-errors";
import {
  FINGERPRINT_VERSION,
  type LedgerPostInput,
  buildLedgerPostPayload,
  computeFingerprint,
  createTrustedLedgerContext,
  isTrustedLedgerContext,
} from "./ledger-contract";

const A1 = "01a21242-0000-7000-8000-00000000a001";
const A2 = "01a21242-0000-7000-8000-00000000a002";
const TENANT = "01a21242-0000-7000-8000-0000000d0001";
const ACTOR = "01a21242-0000-7000-8000-00000000c001";

const platformCtx = createTrustedLedgerContext({ owner: { kind: "platform" }, actorId: null, operation: "fund" });
const tenantCtx = createTrustedLedgerContext({ owner: { kind: "tenant", tenantId: TENANT }, actorId: ACTOR, operation: "fund" });

function input(overrides: Partial<LedgerPostInput> = {}): LedgerPostInput {
  return {
    currency: Currency.USD,
    effectiveAt: new Date("2026-11-25T00:00:00Z"),
    idempotencyKey: "k-1",
    legs: [
      { accountId: A1, amountMicros: microsFromBigInt(1_000_000n) },
      { accountId: A2, amountMicros: microsFromBigInt(-1_000_000n) },
    ],
    ...overrides,
  };
}

describe("trusted context", () => {
  it("brands a server-constructed context; a plain object is not trusted", () => {
    expect(isTrustedLedgerContext(platformCtx)).toBe(true);
    expect(isTrustedLedgerContext({ owner: { kind: "platform" }, actorId: null, operation: "fund" })).toBe(false);
    expect(isTrustedLedgerContext(null)).toBe(false);
  });
  it("rejects an invalid tenant/actor uuid and an empty operation", () => {
    expect(() => createTrustedLedgerContext({ owner: { kind: "tenant", tenantId: "not-a-uuid" }, actorId: null, operation: "fund" })).toThrow(LedgerError);
    expect(() => createTrustedLedgerContext({ owner: { kind: "platform" }, actorId: "bad", operation: "fund" })).toThrow(LedgerError);
    expect(() => createTrustedLedgerContext({ owner: { kind: "platform" }, actorId: null, operation: "  " })).toThrow(LedgerError);
  });
});

describe("canonical fingerprint", () => {
  it("is deterministic for identical inputs", () => {
    expect(computeFingerprint(platformCtx, input())).toBe(computeFingerprint(platformCtx, input()));
  });
  it("is INSENSITIVE to leg input order (double-entry set is unordered)", () => {
    const reordered = input({
      legs: [
        { accountId: A2, amountMicros: microsFromBigInt(-1_000_000n) },
        { accountId: A1, amountMicros: microsFromBigInt(1_000_000n) },
      ],
    });
    expect(computeFingerprint(platformCtx, reordered)).toBe(computeFingerprint(platformCtx, input()));
  });
  it("changes when any financially-significant field changes", () => {
    const base = computeFingerprint(platformCtx, input());
    expect(computeFingerprint(platformCtx, input({ legs: [
      { accountId: A1, amountMicros: microsFromBigInt(2_000_000n) },
      { accountId: A2, amountMicros: microsFromBigInt(-2_000_000n) },
    ] }))).not.toBe(base);
    expect(computeFingerprint(platformCtx, input({ effectiveAt: new Date("2026-11-26T00:00:00Z") }))).not.toBe(base);
    expect(computeFingerprint(platformCtx, input({ currency: Currency.EUR }))).not.toBe(base);
    expect(computeFingerprint(tenantCtx, input())).not.toBe(base); // owner + actor differ
    expect(computeFingerprint(createTrustedLedgerContext({ owner: { kind: "platform" }, actorId: null, operation: "adjust" }), input())).not.toBe(base);
  });
});

describe("DB payload assembly", () => {
  it("builds the exact DB field set; platform owner → null tenant; amounts as integer strings", () => {
    const p = buildLedgerPostPayload(platformCtx, input());
    expect(p.operation).toBe("fund");
    expect(p.ownerTenantId).toBeNull();
    expect(p.actorId).toBeNull();
    expect(p.fingerprintVersion).toBe(FINGERPRINT_VERSION);
    expect(p.legs).toEqual([
      { accountId: A1, amountMicros: "1000000" },
      { accountId: A2, amountMicros: "-1000000" },
    ]);
    expect(p.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
  it("carries tenant owner + actor from the trusted context, never from input", () => {
    const p = buildLedgerPostPayload(tenantCtx, input());
    expect(p.ownerTenantId).toBe(TENANT);
    expect(p.actorId).toBe(ACTOR);
  });
  it("rejects <2 legs, a zero-value leg and an invalid account uuid", () => {
    expect(() => buildLedgerPostPayload(platformCtx, input({ legs: [{ accountId: A1, amountMicros: microsFromBigInt(1n) }] }))).toThrow(LedgerError);
    expect(() => buildLedgerPostPayload(platformCtx, input({ legs: [
      { accountId: A1, amountMicros: microsFromBigInt(0n) },
      { accountId: A2, amountMicros: microsFromBigInt(0n) },
    ] }))).toThrow(LedgerError);
    expect(() => buildLedgerPostPayload(platformCtx, input({ legs: [
      { accountId: "nope", amountMicros: microsFromBigInt(1n) },
      { accountId: A2, amountMicros: microsFromBigInt(-1n) },
    ] }))).toThrow(LedgerError);
  });
});
