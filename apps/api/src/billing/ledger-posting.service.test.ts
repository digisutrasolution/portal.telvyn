import { describe, it, expect } from "vitest";
import { Currency } from "@prisma/client";
import type { PrismaService } from "@/infra/prisma.service";
import { microsFromBigInt } from "./money";
import { LedgerError } from "./ledger-errors";
import { type LedgerPostInput, createTrustedLedgerContext } from "./ledger-contract";
import { LedgerPostingService } from "./ledger-posting.service";

const A1 = "01a21242-0000-7000-8000-00000000a001";
const A2 = "01a21242-0000-7000-8000-00000000a002";
const TENANT = "01a21242-0000-7000-8000-0000000d0001";
const ACTOR = "01a21242-0000-7000-8000-00000000c001";
const TXID = "01a21242-0000-7000-8000-0000000000ff";

type RawCall = { sql: string; values: unknown[] };

/** Fake interactive tx recording $queryRaw calls; `onPost` controls the ledger_post call. */
function fakeTx(onPost: (payload: unknown) => Promise<Array<{ id: string }>>) {
  const calls: RawCall[] = [];
  const $queryRaw = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    calls.push({ sql, values });
    if (sql.includes("ledger_post")) return onPost(JSON.parse(values[0] as string));
    return Promise.resolve([]); // set_config
  };
  return { tx: { $queryRaw } as never, calls };
}

function serviceWith(onPost: (payload: unknown) => Promise<Array<{ id: string }>>) {
  const { tx, calls } = fakeTx(onPost);
  const prisma = { $transaction: (cb: (t: unknown) => unknown) => cb(tx) } as unknown as PrismaService;
  return { svc: new LedgerPostingService(prisma), calls };
}

function input(overrides: Partial<LedgerPostInput> = {}): LedgerPostInput {
  return {
    currency: Currency.USD,
    effectiveAt: new Date("2026-11-25T00:00:00Z"),
    idempotencyKey: "k-1",
    legs: [
      { accountId: A1, amountMicros: microsFromBigInt(1_250_000n) },
      { accountId: A2, amountMicros: microsFromBigInt(-1_250_000n) },
    ],
    ...overrides,
  };
}
const gucValue = (calls: RawCall[], name: string) => calls.find((c) => c.sql.includes(name))?.values[0];

describe("LedgerPostingService — authorization boundary", () => {
  it("rejects a non-trusted (forged/plain) context before any DB call", async () => {
    const { svc, calls } = serviceWith(async () => [{ id: TXID }]);
    const forged = { owner: { kind: "platform" }, actorId: null, operation: "fund" } as never;
    await expect(svc.post(forged, input())).rejects.toMatchObject({ kind: "MISSING_AUTHORIZATION_CONTEXT" });
    expect(calls.length).toBe(0);
  });
});

describe("LedgerPostingService — trusted context establishes GUCs (not the caller)", () => {
  it("platform context → is_platform=on, empty tenant + actor; payload ownerTenantId null", async () => {
    let seen: Record<string, unknown> = {};
    const { svc, calls } = serviceWith(async (p) => { seen = p as Record<string, unknown>; return [{ id: TXID }]; });
    const ctx = createTrustedLedgerContext({ owner: { kind: "platform" }, actorId: null, operation: "fund" });
    const r = await svc.post(ctx, input());
    expect(r).toEqual({ transactionId: TXID, committed: true });
    expect(gucValue(calls, "app.tenant_id")).toBe("");
    expect(gucValue(calls, "app.is_platform")).toBe("on");
    expect(gucValue(calls, "app.actor_id")).toBe("");
    expect(seen.ownerTenantId).toBeNull();
    expect(seen.legs).toEqual([
      { accountId: A1, amountMicros: "1250000" }, // exact integer-micros strings
      { accountId: A2, amountMicros: "-1250000" },
    ]);
  });

  it("tenant context → tenant_id + actor set, is_platform=off; payload owner/actor from context", async () => {
    let seen: Record<string, unknown> = {};
    const { svc, calls } = serviceWith(async (p) => { seen = p as Record<string, unknown>; return [{ id: TXID }]; });
    const ctx = createTrustedLedgerContext({ owner: { kind: "tenant", tenantId: TENANT }, actorId: ACTOR, operation: "adjust" });
    await svc.post(ctx, input());
    expect(gucValue(calls, "app.tenant_id")).toBe(TENANT);
    expect(gucValue(calls, "app.is_platform")).toBe("off");
    expect(gucValue(calls, "app.actor_id")).toBe(ACTOR);
    expect(seen.ownerTenantId).toBe(TENANT);
    expect(seen.actorId).toBe(ACTOR);
    expect(seen.operation).toBe("adjust");
  });

  it("all three GUCs are always set explicitly (no inherited context)", async () => {
    const { svc, calls } = serviceWith(async () => [{ id: TXID }]);
    await svc.post(createTrustedLedgerContext({ owner: { kind: "platform" }, actorId: null, operation: "fund" }), input());
    expect(calls.filter((c) => c.sql.includes("set_config")).length).toBe(3);
  });
});

describe("LedgerPostingService — SQLSTATE → typed error mapping", () => {
  const cases: Array<[string, string]> = [
    ["LG002", "INVALID_LEDGER_STRUCTURE"],
    ["LG003", "CURRENCY_MISMATCH"],
    ["LG004", "OWNERSHIP_MISMATCH"],
    ["LG020", "IDEMPOTENCY_CONFLICT"],
    ["LG030", "MISSING_AUTHORIZATION_CONTEXT"],
    ["LG032", "INVALID_MONEY_INPUT"],
    ["42501", "DATABASE_PRIVILEGE"],
    ["40001", "CONCURRENCY"],
  ];
  for (const [sqlstate, kind] of cases) {
    it(`maps ${sqlstate} → ${kind} and does not return a transaction id`, async () => {
      const { svc } = serviceWith(async () => { throw { code: "P2010", meta: { code: sqlstate, message: `x ${sqlstate}` } }; });
      const ctx = createTrustedLedgerContext({ owner: { kind: "platform" }, actorId: null, operation: "fund" });
      await expect(svc.post(ctx, input())).rejects.toBeInstanceOf(LedgerError);
      await expect(svc.post(ctx, input())).rejects.toMatchObject({ kind });
    });
  }
  it("maps an unknown error to UNKNOWN without leaking it", async () => {
    const { svc } = serviceWith(async () => { throw new Error("connection reset: host=secret pw=secret"); });
    const ctx = createTrustedLedgerContext({ owner: { kind: "platform" }, actorId: null, operation: "fund" });
    await expect(svc.post(ctx, input())).rejects.toMatchObject({ kind: "UNKNOWN", message: "unexpected ledger failure" });
  });

  // F03-D: a COMMIT-time deferred-trigger failure surfaces as an Unknown error
  // WITHOUT meta.code (classified by message text). This verifies the application
  // rejection contract (B); the actual PostgreSQL deferred-constraint failures (A)
  // are exercised by the 43 DB-level ledger tests (LG005 / unbalanced at COMMIT).
  it("maps a deferred COMMIT-time trigger message to DEFERRED_INVARIANT (no meta.code)", async () => {
    const { svc } = serviceWith(async () => {
      throw { message: "Error querying the database: ERROR: idempotency key 01.. committed without a result transaction" };
    });
    const ctx = createTrustedLedgerContext({ owner: { kind: "platform" }, actorId: null, operation: "fund" });
    await expect(svc.post(ctx, input())).rejects.toMatchObject({ kind: "DEFERRED_INVARIANT" });
  });
});
