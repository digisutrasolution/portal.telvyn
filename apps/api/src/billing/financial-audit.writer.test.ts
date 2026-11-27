/**
 * Phase 13-2B S2 — FinancialAuditWriter validation (pure; no database).
 * Owner decisions F1 (empty catalog), F3/F4 (attribution), F5 (metadata),
 * F7 (idempotency reference). Database behaviour is covered by
 * test/financial-audit-foundation.e2e.test.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertTransactionClient,
  buildFinancialAuditRow,
  containsSensitiveKey,
  FINANCIAL_AUDIT_OPERATIONS,
  FinancialAuditError,
  FinancialAuditWriter,
  isSensitiveKey,
  normalizeFinancialAuditMetadata,
  type FinancialAuditActor,
  type FinancialAuditEventInput,
} from "./financial-audit.writer";

const OPS = new Set(["test_only.audit_probe"]);
const T1 = "0190a1b2-c3d4-7e5f-8a9b-000000000001";
const T2 = "0190a1b2-c3d4-7e5f-8a9b-000000000002";
const U1 = "0190a1b2-c3d4-7e5f-8a9b-0000000000a1";

const actor = (tenantType: "PLATFORM" | "CUSTOMER" | "RESELLER" = "CUSTOMER", tenantId = T1): FinancialAuditActor => ({
  ctx: { userId: U1, tenantId, tenantType, membershipId: "m", permissions: new Set() },
  req: { ipAddress: "127.0.0.1", userAgent: "ua" },
});
const event = (over: Partial<FinancialAuditEventInput> = {}): FinancialAuditEventInput => ({
  operation: "test_only.audit_probe",
  tenantId: T1,
  reasonCode: "TEST_PROBE",
  ...over,
});

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof FinancialAuditError) return e.reason;
    throw e;
  }
  return "NO_ERROR";
}

describe("operation catalog (F1)", () => {
  it("the production catalog is empty in S2 — no operation is named", () => {
    expect(FINANCIAL_AUDIT_OPERATIONS.size).toBe(0);
  });

  it("refuses every operation under the production catalog (inert)", () => {
    expect(reason(() => buildFinancialAuditRow(actor(), event(), FINANCIAL_AUDIT_OPERATIONS))).toBe("unknown_operation");
  });

  it("refuses an operation outside the injected catalog and a malformed operation", () => {
    expect(reason(() => buildFinancialAuditRow(actor(), event({ operation: "other.op" }), OPS))).toBe("unknown_operation");
    expect(reason(() => buildFinancialAuditRow(actor(), event({ operation: "Bad Op" }), OPS))).toBe("invalid_event");
  });

  it("rejects a malformed catalog entry at construction", () => {
    expect(() => new FinancialAuditWriter(new Set(["NOT VALID"]))).toThrow();
  });
});

describe("attribution (F3/F4)", () => {
  it("takes the actor from the server-derived context only and records ALLOWED", () => {
    const row = buildFinancialAuditRow(actor(), { ...event(), actorUserId: "forged" } as FinancialAuditEventInput, OPS);
    expect(row.actorUserId).toBe(U1);
    expect(row.actorTenantId).toBe(T1);
    expect(row.tenantId).toBe(T1);
    expect(row.decision).toBe("ALLOWED");
    expect(row).not.toHaveProperty("createdAt");
  });

  it("fails closed without an authenticated context", () => {
    expect(reason(() => buildFinancialAuditRow(undefined, event(), OPS))).toBe("missing_context");
    expect(reason(() => buildFinancialAuditRow({ ctx: undefined as never, req: { ipAddress: null, userAgent: null } }, event(), OPS))).toBe(
      "missing_context",
    );
  });

  it("a non-platform actor cannot attribute an event to another tenant", () => {
    expect(reason(() => buildFinancialAuditRow(actor("CUSTOMER"), event({ tenantId: T2 }), OPS))).toBe("attribution_mismatch");
    expect(reason(() => buildFinancialAuditRow(actor("RESELLER"), event({ tenantId: T2 }), OPS))).toBe("attribution_mismatch");
  });

  it("a platform actor stays distinguishable from the owner tenant", () => {
    const row = buildFinancialAuditRow(actor("PLATFORM", T2), event({ tenantId: T1 }), OPS);
    expect(row.actorTenantId).toBe(T2);
    expect(row.tenantId).toBe(T1);
  });
});

describe("required fields and formats", () => {
  it("rejects a missing/malformed tenantId, reasonCode, ids, permission and correlationId", () => {
    const cases: Partial<FinancialAuditEventInput>[] = [
      { tenantId: "" },
      { reasonCode: "lowercase" },
      { reasonCode: "" },
      { billingAccountId: "not-a-uuid" },
      { stepUpGrantId: "x" },
      { ledgerTransactionId: "1" },
      { permission: "Wallet Read" },
      { correlationId: "" },
      { correlationId: "c".repeat(129) },
      { idempotencyKey: "" },
    ];
    for (const c of cases) expect(reason(() => buildFinancialAuditRow(actor(), event(c), OPS))).toBe("invalid_event");
  });

  it("keeps the idempotency key as a plain reference (F7)", () => {
    const row = buildFinancialAuditRow(actor(), event({ idempotencyKey: "k-1", correlationId: "c-1" }), OPS);
    expect(row.idempotencyKey).toBe("k-1");
    expect(row.correlationId).toBe("c-1");
  });

  it("bounds the user agent like requestContext()", () => {
    const a = actor();
    a.req = { ipAddress: null, userAgent: "u".repeat(900) };
    expect(buildFinancialAuditRow(a, event(), OPS).userAgent).toHaveLength(512);
  });
});

describe("metadata (F5)", () => {
  it("accepts a bounded plain object and treats null/undefined as absent", () => {
    expect(normalizeFinancialAuditMetadata({ status: "ACTIVE", n: 1 }, "after")).toEqual({ status: "ACTIVE", n: 1 });
    expect(normalizeFinancialAuditMetadata(null, "after")).toBeUndefined();
    expect(normalizeFinancialAuditMetadata(undefined, "after")).toBeUndefined();
  });

  it("rejects non-objects, too many keys, oversize and non-serializable values", () => {
    expect(reason(() => normalizeFinancialAuditMetadata([1], "x"))).toBe("invalid_event");
    expect(reason(() => normalizeFinancialAuditMetadata("s", "x"))).toBe("invalid_event");
    expect(reason(() => normalizeFinancialAuditMetadata(new Date(), "x"))).toBe("invalid_event");
    expect(reason(() => normalizeFinancialAuditMetadata(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i])), "x"))).toBe(
      "invalid_event",
    );
    expect(reason(() => normalizeFinancialAuditMetadata({ blob: "x".repeat(4100) }, "x"))).toBe("invalid_event");
    expect(reason(() => normalizeFinancialAuditMetadata({ n: 10n }, "x"))).toBe("invalid_event");
    expect(reason(() => normalizeFinancialAuditMetadata({ n: Number.NaN }, "x"))).toBe("invalid_event");
  });

  it("measures size in jsonb text form (', ' and ': ' separators)", () => {
    // 4096 bytes in JSON.stringify form, but larger in jsonb text form → refused.
    const filler = "x".repeat(4096 - JSON.stringify({ a: "" }).length);
    expect(Buffer.byteLength(JSON.stringify({ a: filler }))).toBe(4096);
    expect(reason(() => normalizeFinancialAuditMetadata({ a: filler }, "x"))).toBe("invalid_event");
  });

  it("rejects sensitive keys at any depth — the whole event is refused", () => {
    for (const k of ["password", "newPassword", "refresh_token", "accessToken", "totpCode", "mfaSecret", "recoveryCodes", "cvv", "card-number", "connectionString", "DATABASE_URL", "apiKey", "otp"]) {
      expect(isSensitiveKey(k)).toBe(true);
    }
    expect(containsSensitiveKey({ a: { b: [{ token: "x" }] } })).toBe(true);
    expect(reason(() => buildFinancialAuditRow(actor(), event({ details: { nested: { secret: "s" } } }), OPS))).toBe("sensitive_metadata");
  });

  it("does not over-match ordinary financial keys", () => {
    for (const k of ["status", "footprint", "company", "span", "reasonCode", "accountNumber", "currency", "mode", "label"]) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });
});

describe("inert boundary (S2)", () => {
  it("only BillingModule imports the writer — no controller, service or other caller exists", () => {
    const root = join(__dirname, "..");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
      }
    };
    walk(root);
    const importers = files
      .filter((f) => /financial-audit\.writer/.test(readFileSync(f, "utf8")))
      .map((f) => relative(root, f).replace(/\\/g, "/"))
      .filter((f) => f !== "billing/financial-audit.writer.ts");
    expect(importers).toEqual(["billing/billing.module.ts"]);
  });
});

describe("transaction client contract (no fallback)", () => {
  it("refuses a base client (anything exposing $transaction) and non-clients", () => {
    const base = { $transaction: () => undefined, financialAuditEvent: { create: () => undefined } };
    expect(reason(() => assertTransactionClient(base))).toBe("not_in_transaction");
    expect(reason(() => assertTransactionClient(undefined))).toBe("not_in_transaction");
    expect(reason(() => assertTransactionClient({}))).toBe("not_in_transaction");
  });

  it("record() refuses a base client before validating or writing anything", async () => {
    let writes = 0;
    const base = { $transaction: () => undefined, financialAuditEvent: { create: () => ++writes } };
    const writer = new FinancialAuditWriter(OPS);
    await expect(writer.record(base as never, actor(), event())).rejects.toMatchObject({ reason: "not_in_transaction" });
    expect(writes).toBe(0);
  });

  it("record() writes exactly once through the supplied transaction client and propagates its failure", async () => {
    const calls: unknown[] = [];
    const tx = { financialAuditEvent: { create: async (a: unknown) => (calls.push(a), { id: "id-1" }) } };
    const writer = new FinancialAuditWriter(OPS);
    await expect(writer.record(tx as never, actor(), event())).resolves.toEqual({ id: "id-1" });
    expect(calls).toHaveLength(1);
    const failing = { financialAuditEvent: { create: async () => Promise.reject(new Error("db down")) } };
    await expect(writer.record(failing as never, actor(), event())).rejects.toThrow("db down");
  });
});
