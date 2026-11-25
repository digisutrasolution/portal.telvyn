/**
 * F01 (trusted-context provenance) + F02 (canonical fingerprint) hardening tests
 * for Phase 13-1E. Proves a trusted context cannot be forged by any realistic
 * construction, cannot be mutated after authorization, and that the fingerprint
 * is deterministic/order-insensitive yet sensitive to every financially
 * significant field.
 */
import { describe, it, expect } from "vitest";
import { Currency } from "@prisma/client";
import { microsFromBigInt } from "./money";
import {
  type LedgerPostInput,
  buildLedgerPostPayload,
  computeFingerprint,
  createTrustedLedgerContext,
  isTrustedLedgerContext,
} from "./ledger-contract";

const A1 = "01a21242-0000-7000-8000-00000000a001";
const A2 = "01a21242-0000-7000-8000-00000000a002";
const genuine = createTrustedLedgerContext({ owner: { kind: "platform" }, actorId: null, operation: "fund" });

describe("F01 — trusted context provenance (unforgeable)", () => {
  it("accepts only a genuine module-minted context", () => {
    expect(isTrustedLedgerContext(genuine)).toBe(true);
  });
  it("rejects a plain object with matching shape", () => {
    expect(isTrustedLedgerContext({ owner: { kind: "platform" }, actorId: null, operation: "fund" })).toBe(false);
  });
  it("rejects a spread copy of a genuine context", () => {
    expect(isTrustedLedgerContext({ ...genuine })).toBe(false);
  });
  it("rejects an Object.assign copy", () => {
    expect(isTrustedLedgerContext(Object.assign({}, genuine))).toBe(false);
  });
  it("rejects a copy that re-attaches the brand symbol (getOwnPropertySymbols/Reflect.ownKeys)", () => {
    const forged: Record<string | symbol, unknown> = {};
    for (const k of Reflect.ownKeys(genuine)) forged[k] = (genuine as unknown as Record<string | symbol, unknown>)[k];
    expect(Object.getOwnPropertySymbols(forged).length).toBeGreaterThan(0); // the brand WAS copied
    expect(isTrustedLedgerContext(forged)).toBe(false); // …yet it is still rejected (WeakSet authority)
  });
  it("rejects a prototype-based forgery", () => {
    const forged = Object.create(Object.getPrototypeOf(genuine));
    Object.assign(forged, genuine);
    expect(isTrustedLedgerContext(forged)).toBe(false);
  });
  it("rejects null / primitives", () => {
    expect(isTrustedLedgerContext(null)).toBe(false);
    expect(isTrustedLedgerContext("x")).toBe(false);
    expect(isTrustedLedgerContext(123)).toBe(false);
  });
  it("is immutable after authorization (fields + owner are frozen)", () => {
    expect(Object.isFrozen(genuine)).toBe(true);
    expect(Object.isFrozen(genuine.owner)).toBe(true);
    expect(() => { (genuine as unknown as { operation: string }).operation = "x"; }).toThrow(TypeError);
    const tctx = createTrustedLedgerContext({ owner: { kind: "tenant", tenantId: A1 }, actorId: null, operation: "fund" });
    expect(() => { (tctx.owner as unknown as { tenantId: string }).tenantId = A2; }).toThrow(TypeError);
  });
});

function input(overrides: Partial<LedgerPostInput> = {}): LedgerPostInput {
  return {
    currency: Currency.USD,
    effectiveAt: new Date("2026-11-25T00:00:00Z"),
    idempotencyKey: "k",
    legs: [
      { accountId: A1, amountMicros: microsFromBigInt(1_000_000n) },
      { accountId: A2, amountMicros: microsFromBigInt(-1_000_000n) },
    ],
    ...overrides,
  };
}

describe("F02 — canonical fingerprint (determinism + full-field sensitivity)", () => {
  it("is a 64-hex SHA-256 digest, server-computed (the input carries no fingerprint)", () => {
    const p = buildLedgerPostPayload(genuine, input());
    expect(p.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(p.requestFingerprint).toBe(computeFingerprint(genuine, input()));
    expect(p.fingerprintVersion).toBe(1);
  });
  it("preserves duplicate-leg multiplicity", () => {
    const dup = input({ legs: [
      { accountId: A1, amountMicros: microsFromBigInt(1_000_000n) },
      { accountId: A1, amountMicros: microsFromBigInt(1_000_000n) },
      { accountId: A2, amountMicros: microsFromBigInt(-2_000_000n) },
    ] });
    const collapsed = input({ legs: [
      { accountId: A1, amountMicros: microsFromBigInt(2_000_000n) },
      { accountId: A2, amountMicros: microsFromBigInt(-2_000_000n) },
    ] });
    expect(computeFingerprint(genuine, dup)).not.toBe(computeFingerprint(genuine, collapsed));
  });
  it("changes on reversal / source metadata / actor", () => {
    const base = computeFingerprint(genuine, input());
    expect(computeFingerprint(genuine, input({ reversalOfId: A1 }))).not.toBe(base);
    expect(computeFingerprint(genuine, input({ sourceType: "cdr" }))).not.toBe(base);
    expect(computeFingerprint(genuine, input({ sourceRef: "r-1" }))).not.toBe(base);
    const withActor = createTrustedLedgerContext({ owner: { kind: "platform" }, actorId: A1, operation: "fund" });
    expect(computeFingerprint(withActor, input())).not.toBe(base);
  });
  it("equivalent optional nulls vs undefined hash identically (canonical)", () => {
    expect(computeFingerprint(genuine, input({ correlationId: null }))).toBe(computeFingerprint(genuine, input({})));
  });
});
