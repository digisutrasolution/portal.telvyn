/**
 * Phase 13-1D — LedgerPostingService integration against real PostgreSQL 18.
 *
 * Runs the adapter as the restricted runtime role (telvyn_app, via the app's
 * PrismaService / DATABASE_URL); fixtures (tenants, accounts, verification) use
 * the privileged migrator connection (fixturePrisma). No migrations are applied;
 * ledger history is immutable, so run-unique namespaces are used and nothing is
 * deleted. A test-only trusted context stands in for the (deferred) commercial
 * authorization — it is NOT a production bypass (no production code constructs one).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Currency } from "@prisma/client";
import { fixturePrisma } from "./fixture-db";
import { PrismaService } from "@/infra/prisma.service";
import { parseDecimalToMicros } from "@/billing/money";
import { type LedgerOwner, type LedgerPostInput, createTrustedLedgerContext } from "@/billing/ledger-contract";
import { LedgerPostingService } from "@/billing/ledger-posting.service";

const fix = fixturePrisma;
const app = new PrismaService(); // telvyn_app runtime via DATABASE_URL
const svc = new LedgerPostingService(app);

const RUN = `131d-${Date.now().toString(36)}`;
let TA = "";
let TB = "";
const ACC: Record<string, string> = {};

async function mkAccount(key: string, tenantId: string | null, code: string, type: "ASSET" | "LIABILITY" | "REVENUE", nb: "DEBIT" | "CREDIT", currency: Currency = Currency.USD) {
  const r = await fix.ledgerAccount.create({ data: { tenantId, currency, code, name: code, type, normalBalance: nb } });
  ACC[key] = r.id;
}
const ctxFor = (owner: LedgerOwner, actorId: string | null, operation = "fund") => createTrustedLedgerContext({ owner, actorId, operation });

beforeAll(async () => {
  const ta = await fix.tenant.create({ data: { slug: `${RUN}-ta`, name: `${RUN}-ta`, type: "CUSTOMER" } });
  const tb = await fix.tenant.create({ data: { slug: `${RUN}-tb`, name: `${RUN}-tb`, type: "CUSTOMER" } });
  TA = ta.id;
  TB = tb.id;
  await mkAccount("platCash", null, `${RUN}-PCASH`, "ASSET", "DEBIT");
  await mkAccount("platRev", null, `${RUN}-PREV`, "REVENUE", "CREDIT");
  await mkAccount("taAsset", TA, `${RUN}-TA-A`, "ASSET", "DEBIT");
  await mkAccount("taLiab", TA, `${RUN}-TA-L`, "LIABILITY", "CREDIT");
  await mkAccount("tbLiab", TB, `${RUN}-TB-L`, "LIABILITY", "CREDIT");
}, 60_000);

afterAll(async () => {
  await app.$disconnect();
});

function platformInput(key: string, decimal = "1.25"): LedgerPostInput {
  const amt = parseDecimalToMicros(decimal);
  return {
    currency: Currency.USD,
    effectiveAt: new Date("2026-11-25T00:00:00Z"),
    idempotencyKey: key,
    legs: [
      { accountId: ACC.platCash, amountMicros: amt },
      { accountId: ACC.platRev, amountMicros: parseDecimalToMicros(`-${decimal}`) },
    ],
  };
}

async function txnOwner(id: string): Promise<string | null> {
  const r = (await fix.$queryRawUnsafe(`SELECT "ownerTenantId"::text o FROM "LedgerTransaction" WHERE "id"=$1::uuid`, id)) as Array<{ o: string | null }>;
  return r[0]?.o ?? null;
}

describe("13-1D adapter — authorized posting", () => {
  it("posts an authorized platform transaction and commits (balanced)", async () => {
    const r = await svc.post(ctxFor({ kind: "platform" }, null), platformInput(`${RUN}-p1`));
    expect(r.committed).toBe(true);
    expect(r.transactionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await txnOwner(r.transactionId)).toBeNull();
    const legs = (await fix.$queryRawUnsafe(`SELECT count(*)::int n, coalesce(sum("amountMicros"::numeric),0)::text s FROM "LedgerLeg" WHERE "transactionId"=$1::uuid`, r.transactionId)) as Array<{ n: number; s: string }>;
    expect(legs[0]).toEqual({ n: 2, s: "0" });
  });

  it("posts an authorized tenant transaction owned by that tenant", async () => {
    const r = await svc.post(ctxFor({ kind: "tenant", tenantId: TA }, null), {
      currency: Currency.USD, effectiveAt: new Date("2026-11-25T00:00:00Z"), idempotencyKey: `${RUN}-t1`,
      legs: [{ accountId: ACC.taAsset, amountMicros: parseDecimalToMicros("5") }, { accountId: ACC.taLiab, amountMicros: parseDecimalToMicros("-5") }],
    });
    expect(await txnOwner(r.transactionId)).toBe(TA);
  });

  it("stores exact micro amounts (serialized as integer strings, no precision loss)", async () => {
    const r = await svc.post(ctxFor({ kind: "platform" }, null), platformInput(`${RUN}-exact`, "1.234567"));
    const legs = (await fix.$queryRawUnsafe(`SELECT "amountMicros"::text a FROM "LedgerLeg" WHERE "transactionId"=$1::uuid ORDER BY "amountMicros" DESC`, r.transactionId)) as Array<{ a: string }>;
    expect(legs.map((l) => l.a)).toEqual(["1234567", "-1234567"]);
  });
});

describe("13-1D adapter — authorization + ownership", () => {
  it("rejects a forged (non-trusted) context before touching the DB", async () => {
    const forged = { owner: { kind: "platform" }, actorId: null, operation: "fund" } as never;
    await expect(svc.post(forged, platformInput(`${RUN}-forged`))).rejects.toMatchObject({ kind: "MISSING_AUTHORIZATION_CONTEXT" });
  });

  it("rejects a cross-tenant payload (tenant A context, tenant B account)", async () => {
    await expect(svc.post(ctxFor({ kind: "tenant", tenantId: TA }, null), {
      currency: Currency.USD, effectiveAt: new Date("2026-11-25T00:00:00Z"), idempotencyKey: `${RUN}-xt`,
      legs: [{ accountId: ACC.taAsset, amountMicros: parseDecimalToMicros("1") }, { accountId: ACC.tbLiab, amountMicros: parseDecimalToMicros("-1") }],
    })).rejects.toMatchObject({ kind: "OWNERSHIP_MISMATCH" });
  });

  it("rejects an unbalanced post (structure) through the adapter", async () => {
    await expect(svc.post(ctxFor({ kind: "platform" }, null), {
      currency: Currency.USD, effectiveAt: new Date("2026-11-25T00:00:00Z"), idempotencyKey: `${RUN}-ub`,
      legs: [{ accountId: ACC.platCash, amountMicros: parseDecimalToMicros("1") }, { accountId: ACC.platRev, amountMicros: parseDecimalToMicros("-0.9") }],
    })).rejects.toMatchObject({ kind: "INVALID_LEDGER_STRUCTURE" });
  });
});

describe("13-1D adapter — idempotency", () => {
  it("replays an identical request to the same transaction", async () => {
    const ctx = ctxFor({ kind: "platform" }, null);
    const a = await svc.post(ctx, platformInput(`${RUN}-idem`));
    const b = await svc.post(ctx, platformInput(`${RUN}-idem`));
    expect(b.transactionId).toBe(a.transactionId);
  });
  it("rejects the same key with a changed payload (conflict)", async () => {
    const ctx = ctxFor({ kind: "platform" }, null);
    await svc.post(ctx, platformInput(`${RUN}-conf`, "1"));
    await expect(svc.post(ctx, platformInput(`${RUN}-conf`, "2"))).rejects.toMatchObject({ kind: "IDEMPOTENCY_CONFLICT" });
  });
});

describe("13-1D adapter — transaction + connection safety", () => {
  it("rolls back cleanly inside a caller transaction (no transaction persists)", async () => {
    const ctx = ctxFor({ kind: "platform" }, null);
    await expect(app.$transaction(async (tx) => {
      await svc.postInTransaction(tx, ctx, platformInput(`${RUN}-rollback`));
      throw new Error("force-rollback");
    })).rejects.toThrow("force-rollback");
    const n = (await fix.$queryRawUnsafe(`SELECT count(*)::int n FROM "IdempotencyKey" WHERE "operation"='fund' AND "key"=$1`, `${RUN}-rollback`)) as Array<{ n: number }>;
    expect(n[0].n).toBe(0);
  });

  it("does not leak transaction-local context across pooled reuse (tenant → platform → platform-after-rollback)", async () => {
    await svc.post(ctxFor({ kind: "tenant", tenantId: TA }, null), {
      currency: Currency.USD, effectiveAt: new Date("2026-11-25T00:00:00Z"), idempotencyKey: `${RUN}-leak-ta`,
      legs: [{ accountId: ACC.taAsset, amountMicros: parseDecimalToMicros("1") }, { accountId: ACC.taLiab, amountMicros: parseDecimalToMicros("-1") }],
    });
    const p1 = await svc.post(ctxFor({ kind: "platform" }, null), platformInput(`${RUN}-leak-p1`));
    expect(await txnOwner(p1.transactionId)).toBeNull(); // platform not attributed to tenant A
    await expect(app.$transaction(async (tx) => {
      await svc.postInTransaction(tx, ctxFor({ kind: "tenant", tenantId: TB }, null), {
        currency: Currency.USD, effectiveAt: new Date("2026-11-25T00:00:00Z"), idempotencyKey: `${RUN}-leak-tb`,
        legs: [{ accountId: ACC.tbLiab, amountMicros: parseDecimalToMicros("1") }, { accountId: ACC.platRev, amountMicros: parseDecimalToMicros("-1") }],
      });
      throw new Error("rollback");
    })).rejects.toThrow();
    const p2 = await svc.post(ctxFor({ kind: "platform" }, null), platformInput(`${RUN}-leak-p2`));
    expect(await txnOwner(p2.transactionId)).toBeNull(); // no leak from the rolled-back tenant tx
  });

  it("keeps the runtime role restricted — telvyn_app still cannot read ledger tables directly (42501)", async () => {
    let code = "NONE";
    try {
      await app.$queryRawUnsafe(`SELECT 1 FROM "LedgerTransaction" LIMIT 1`);
    } catch (e: unknown) {
      code = (e as { meta?: { code?: string } }).meta?.code ?? "NO_CODE";
    }
    expect(code).toBe("42501");
  });
});
