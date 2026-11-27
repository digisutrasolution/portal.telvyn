/**
 * Phase 13-2B S2/S5 — FinancialAuditWriter validation (pure; no database).
 * Owner decisions F1 (catalog), F3/F4 (attribution), F5 (metadata), F7
 * (idempotency reference); S5: O6 (typed schemas, no network data), O7 (insert
 * without RETURNING), P5 (tracked transaction provenance). Database behaviour is covered by
 * test/financial-audit-foundation.e2e.test.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { runInTrackedTransaction } from "@/infra/tracked-transaction";
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

describe("operation catalog (F1, S5)", () => {
  it("the production catalog names exactly the S5 provisioning operation", () => {
    expect([...FINANCIAL_AUDIT_OPERATIONS.keys()]).toEqual(["billing_account.provision"]);
    expect(FINANCIAL_AUDIT_OPERATIONS.get("billing_account.provision")?.permission).toBe("billing.account.provision");
  });

  it("refuses an operation outside the production catalog", () => {
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

  it("never carries request network data into the row (O6)", () => {
    const a = actor();
    a.req = { ipAddress: "203.0.113.7", userAgent: "u".repeat(900) };
    const row = buildFinancialAuditRow(a, event(), OPS);
    expect(row).not.toHaveProperty("ipAddress");
    expect(row).not.toHaveProperty("userAgent");
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
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

describe("caller boundary (S2 → S5)", () => {
  it("only BillingModule and the S5 provisioning service import the writer", () => {
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
    expect(importers.sort()).toEqual(["billing/billing-account-provisioning.service.ts", "billing/billing.module.ts"]);
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

  it("record() refuses a transaction-shaped client that was not opened by runInTrackedTransaction (P5)", async () => {
    const { tx, inserts } = fakeTx();
    const writer = new FinancialAuditWriter(OPS);
    await expect(writer.record(tx as never, actor(), event())).rejects.toMatchObject({ reason: "not_in_transaction" });
    expect(inserts).toHaveLength(0);
  });

  it("record() inserts exactly once, without RETURNING, through the tracked client and propagates failure", async () => {
    const ok = fakeTx();
    const writer = new FinancialAuditWriter(OPS);
    await expect(runInTrackedTransaction(fakePrisma(ok.tx), (tx) => writer.record(tx, actor(), event()))).resolves.toEqual({ id: "id-1" });
    expect(ok.inserts).toHaveLength(1);
    expect(ok.inserts[0]).toContain('INSERT INTO "FinancialAuditEvent"');
    expect(ok.inserts[0]).not.toMatch(/RETURNING/i);
    expect(ok.inserts[0]).not.toMatch(/ipAddress|userAgent/);

    const failing = fakeTx({ insertError: new Error("db down") });
    await expect(runInTrackedTransaction(fakePrisma(failing.tx), (tx) => writer.record(tx, actor(), event()))).rejects.toThrow("db down");
  });

  it("record() refuses a tracked client whose connection is not inside a transaction block (P5)", async () => {
    const auto = fakeTx({ autocommit: true });
    const writer = new FinancialAuditWriter(OPS);
    await expect(runInTrackedTransaction(fakePrisma(auto.tx), (tx) => writer.record(tx, actor(), event()))).rejects.toMatchObject({
      reason: "not_in_transaction",
    });
    expect(auto.inserts).toHaveLength(0);
  });
});

describe("typed provisioning schema (O6)", () => {
  const PROD = FINANCIAL_AUDIT_OPERATIONS;
  const LA = "0190a1b2-c3d4-7e5f-8a9b-0000000000c1";
  const BA = "0190a1b2-c3d4-7e5f-8a9b-0000000000b1";
  const SG = "0190a1b2-c3d4-7e5f-8a9b-0000000000d1";
  const after = {
    accountNumber: "BA-2026-ABCDEFGH2345",
    currency: "USD",
    mode: "PREPAID",
    status: "ACTIVE",
    isDefault: false,
    label: "Main",
    ledgerAccountId: LA,
    ledgerTaxonomy: "customer_funds",
  };
  const allowed = (over: Partial<FinancialAuditEventInput> = {}): FinancialAuditEventInput => ({
    operation: "billing_account.provision",
    tenantId: T1,
    billingAccountId: BA,
    permission: "billing.account.provision",
    stepUpGrantId: SG,
    reasonCode: "ACCOUNT_PROVISIONED",
    after,
    details: { fingerprintVersion: "v1" },
    ...over,
  });
  const plat = () => actor("PLATFORM", T2);

  it("accepts the exact server-derived ALLOWED shape", () => {
    const row = buildFinancialAuditRow(plat(), allowed(), PROD);
    expect(row).toMatchObject({ decision: "ALLOWED", tenantId: T1, actorTenantId: T2, reasonCode: "ACCOUNT_PROVISIONED" });
  });

  it("refuses extra keys, missing keys, a wrong permission, a before image or an unapproved reason", () => {
    const bad: Partial<FinancialAuditEventInput>[] = [
      { after: { ...after, balance: 0 } },
      { after: { ...after, ledgerAccountId: undefined } },
      { after: { ...after, mode: "POSTPAID" } },
      { after: { ...after, accountNumber: "BA-2026-ABCDEFGHIJKL" } }, // I and L are not in the alphabet
      { details: { fingerprintVersion: "v1", extra: true } },
      { details: undefined },
      { before: { status: "NONE" } },
      { permission: "billing.account.other" },
      { permission: null },
      { reasonCode: "SOMETHING_ELSE" },
    ];
    for (const b of bad) expect(reason(() => buildFinancialAuditRow(plat(), allowed(b), PROD))).toBe("invalid_event");
  });

  it("a DENIED event carries only typed details and an approved denial reason", () => {
    const denied = (over: Partial<FinancialAuditEventInput> = {}): FinancialAuditEventInput => ({
      operation: "billing_account.provision",
      tenantId: T1,
      reasonCode: "PERMISSION_DENIED",
      details: { targetTenantId: T2, currency: "USD" },
      ...over,
    });
    const row = buildFinancialAuditRow(actor("CUSTOMER", T1), denied(), PROD, "DENIED");
    expect(row.decision).toBe("DENIED");
    expect(row.tenantId).toBe(T1);
    for (const b of [
      { reasonCode: "ACCOUNT_PROVISIONED" },
      { after },
      { billingAccountId: BA },
      { stepUpGrantId: SG },
      { details: { targetTenantId: T2, label: "x" } },
    ] as Partial<FinancialAuditEventInput>[]) {
      expect(reason(() => buildFinancialAuditRow(actor("CUSTOMER", T1), denied(b), PROD, "DENIED"))).toBe("invalid_event");
    }
  });
});

/** A transaction-shaped fake: tagged-template $queryRaw/$executeRaw, no $transaction. */
function fakeTx(o: { insertError?: Error; autocommit?: boolean } = {}) {
  const inserts: string[] = [];
  let probe: string | null = null;
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = strings.join("?");
      if (q.includes("set_config")) {
        if (!o.autocommit) probe = String(values[0]);
        return [{}];
      }
      if (q.includes("current_setting")) return [{ v: probe }];
      if (q.includes("uuidv7()")) return [{ id: "id-1" }];
      throw new Error(`unexpected query: ${q}`);
    },
    $executeRaw: async (strings: TemplateStringsArray) => {
      if (o.insertError) throw o.insertError;
      inserts.push(strings.join("?"));
      return 1;
    },
  };
  return { tx, inserts };
}

function fakePrisma(tx: object) {
  return { $transaction: (fn: (t: never) => Promise<unknown>) => fn(tx as never) } as never;
}
