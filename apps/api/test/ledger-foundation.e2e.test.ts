/**
 * Phase 13-1B+C — Atomic financial ledger foundation: database integration tests.
 *
 * Exercises the real PostgreSQL 18 ledger against BOTH roles:
 *   - the restricted runtime role (telvyn_app, via the default DATABASE_URL
 *     PrismaClient) — the only sanctioned write path is EXECUTE billing.ledger_post;
 *   - the privileged fixture role (telvyn_migrator, via fixturePrisma) — creates
 *     accounts/tenants and drives the structural/immutability triggers by direct
 *     DML (the triggers fire for the table owner too).
 *
 * Ledger history is immutable, so tests use RUN-UNIQUE namespaces (idempotency
 * keys, account codes, tenant slugs) and never delete posted rows (§28). The
 * disposable telvyn_ledger_e2e database accumulates test rows by design.
 *
 * SQLSTATE contracts: ledger_post and the triggers raise precise codes
 * (LG0xx custom; 23xxx/42501 standard). Prisma surfaces a failed raw query as
 * PrismaClientKnownRequestError P2010 with meta.code = the PostgreSQL SQLSTATE.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { fixturePrisma } from "./fixture-db";

// Privileged connection (telvyn_migrator): fixtures + direct-DML trigger tests.
const fix = fixturePrisma;
// Runtime connection (telvyn_app): the application's restricted role.
const app = new PrismaClient();

const RUN = `131bc-${Date.now().toString(36)}`;
const PLAT = (code: string) => `${RUN}-P-${code}`;

// ---- error assertion helpers ---------------------------------------------
// Immediate raw-query failures surface as Prisma P2010 with meta.code = the
// PostgreSQL SQLSTATE. Deferred (COMMIT-time) constraint-trigger failures surface
// as PrismaClientUnknownRequestError with no meta.code — asserted by message.
async function pgCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e: unknown) {
    const err = e as { code?: string; meta?: { code?: string; message?: string }; message?: string };
    if (err.meta?.code) return err.meta.code;
    return `NO_META_CODE(${err.code ?? "?"})`;
  }
  return "NO_ERROR";
}
async function pgMsg(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e: unknown) {
    const err = e as { meta?: { message?: string }; message?: string };
    return err.meta?.message ?? err.message ?? "";
  }
  return "NO_ERROR";
}

// ---- ledger_post caller (sets trusted session context, then posts) --------
type Ctx = { platform?: boolean; tenantId?: string; actorId?: string };
async function post(client: PrismaClient, ctx: Ctx, payload: Record<string, unknown>): Promise<string> {
  return client.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT set_config('app.is_platform', $1, true)`, ctx.platform ? "on" : "off");
    await tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, ctx.tenantId ?? "");
    await tx.$queryRawUnsafe(`SELECT set_config('app.actor_id', $1, true)`, ctx.actorId ?? "");
    const rows = (await tx.$queryRawUnsafe(
      `SELECT billing.ledger_post($1::jsonb) AS id`,
      JSON.stringify(payload),
    )) as Array<{ id: string }>;
    return rows[0].id;
  });
}

const EFFECTIVE = "2026-11-25T00:00:00Z";
let TA = "";
let TB = "";
const ACC: Record<string, string> = {};

async function makeAccount(opts: {
  key: string;
  tenantId: string | null;
  currency?: "USD" | "EUR";
  code: string;
  type: "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE" | "EQUITY";
  normalBalance: "DEBIT" | "CREDIT";
}) {
  const row = await fix.ledgerAccount.create({
    data: {
      tenantId: opts.tenantId,
      currency: (opts.currency ?? "USD") as "USD" | "EUR",
      code: opts.code,
      name: opts.code,
      type: opts.type,
      normalBalance: opts.normalBalance,
    },
  });
  ACC[opts.key] = row.id;
  return row.id;
}

beforeAll(async () => {
  const ta = await fix.tenant.create({ data: { slug: `${RUN}-ta`, name: `${RUN}-ta`, type: "CUSTOMER" } });
  const tb = await fix.tenant.create({ data: { slug: `${RUN}-tb`, name: `${RUN}-tb`, type: "CUSTOMER" } });
  TA = ta.id;
  TB = tb.id;
  // Platform accounts (USD + one EUR), and per-tenant liability/asset accounts.
  await makeAccount({ key: "platCashUsd", tenantId: null, code: PLAT("CASH-USD"), type: "ASSET", normalBalance: "DEBIT" });
  await makeAccount({ key: "platRevUsd", tenantId: null, code: PLAT("REV-USD"), type: "REVENUE", normalBalance: "CREDIT" });
  await makeAccount({ key: "platEur", tenantId: null, code: PLAT("CASH-EUR"), currency: "EUR", type: "ASSET", normalBalance: "DEBIT" });
  await makeAccount({ key: "taLiab", tenantId: TA, code: `${RUN}-TA-LIAB`, type: "LIABILITY", normalBalance: "CREDIT" });
  await makeAccount({ key: "taAsset", tenantId: TA, code: `${RUN}-TA-ASSET`, type: "ASSET", normalBalance: "DEBIT" });
  await makeAccount({ key: "tbLiab", tenantId: TB, code: `${RUN}-TB-LIAB`, type: "LIABILITY", normalBalance: "CREDIT" });
}, 60_000);

afterAll(async () => {
  await app.$disconnect();
  // Ledger rows (and the tenants/accounts they reference) are immutable / FK-RESTRICT
  // protected and are intentionally NOT deleted — telvyn_ledger_e2e is disposable.
});

// Balanced two-leg platform payload builder.
function balanced(key: string, a = 1_000_000) {
  return {
    operation: "fund",
    currency: "USD",
    effectiveAt: EFFECTIVE,
    idempotencyKey: key,
    // fingerprint depends on the payload (amount) so identical requests replay
    // and a changed payload under the same key is a conflict.
    requestFingerprint: `fp-${key}-${a}`,
    fingerprintVersion: 1,
    legs: [
      { accountId: ACC.platCashUsd, amountMicros: a },
      { accountId: ACC.platRevUsd, amountMicros: -a },
    ],
  };
}

// =========================================================================
describe("13-1 ledger — positive posting", () => {
  it("posts a balanced platform transaction (debit + / credit −, Σ=0)", async () => {
    const id = await post(app, { platform: true }, balanced(`${RUN}-pos-1`));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const legs = (await fix.$queryRawUnsafe(
      `SELECT count(*)::int n, coalesce(sum("amountMicros"::numeric),0)::text s FROM "LedgerLeg" WHERE "transactionId"=$1::uuid`,
      id,
    )) as Array<{ n: number; s: string }>;
    expect(legs[0].n).toBe(2);
    expect(legs[0].s).toBe("0");
  });

  it("posts a tenant transaction with matching session context", async () => {
    const id = await post(app, { tenantId: TA }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE,
      ownerTenantId: TA, idempotencyKey: `${RUN}-pos-tenant`, requestFingerprint: "fp-t", fingerprintVersion: 1,
      legs: [{ accountId: ACC.taAsset, amountMicros: 500_000 }, { accountId: ACC.taLiab, amountMicros: -500_000 }],
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("accepts a balanced 4-leg transaction with large (±1e15) amounts (NUMERIC-safe)", async () => {
    const id = await post(app, { platform: true }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE,
      idempotencyKey: `${RUN}-pos-4leg`, requestFingerprint: "fp-4", fingerprintVersion: 1,
      legs: [
        { accountId: ACC.platCashUsd, amountMicros: 1_000_000_000_000_000 },
        { accountId: ACC.platCashUsd, amountMicros: 1_000_000_000_000_000 },
        { accountId: ACC.platRevUsd, amountMicros: -1_000_000_000_000_000 },
        { accountId: ACC.platRevUsd, amountMicros: -1_000_000_000_000_000 },
      ],
    });
    const bal = (await fix.$queryRawUnsafe(
      `SELECT coalesce(sum("amountMicros"::numeric),0)::text s FROM "LedgerLeg" WHERE "transactionId"=$1::uuid`, id,
    )) as Array<{ s: string }>;
    expect(bal[0].s).toBe("0");
  });

  it("replays an identical idempotent request to the SAME transaction", async () => {
    const k = `${RUN}-idem-replay`;
    const a = await post(app, { platform: true }, balanced(k));
    const b = await post(app, { platform: true }, balanced(k));
    expect(b).toBe(a);
    const cnt = (await fix.$queryRawUnsafe(
      `SELECT count(*)::int n FROM "IdempotencyKey" WHERE "operation"='fund' AND "key"=$1`, k,
    )) as Array<{ n: number }>;
    expect(cnt[0].n).toBe(1);
  });

  it("isolates idempotency per tenant namespace (same key, two tenants → two txns)", async () => {
    const k = `${RUN}-ns`;
    const ta = await post(app, { tenantId: TA }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE, ownerTenantId: TA,
      idempotencyKey: k, requestFingerprint: "fp", fingerprintVersion: 1,
      legs: [{ accountId: ACC.taAsset, amountMicros: 10 }, { accountId: ACC.taLiab, amountMicros: -10 }],
    });
    const tb = await post(app, { tenantId: TB }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE, ownerTenantId: TB,
      idempotencyKey: k, requestFingerprint: "fp", fingerprintVersion: 1,
      legs: [{ accountId: ACC.platCashUsd, amountMicros: 10 }, { accountId: ACC.tbLiab, amountMicros: -10 }],
    });
    expect(ta).not.toBe(tb);
  });
});

describe("13-1 ledger — posting validation (SQLSTATE contracts)", () => {
  it("rejects zero legs (LG001)", async () =>
    expect(await pgCode(() => post(app, { platform: true }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE, idempotencyKey: `${RUN}-z0`, requestFingerprint: "f", fingerprintVersion: 1, legs: [],
    }))).toBe("LG001"));

  it("rejects a single leg (LG001)", async () =>
    expect(await pgCode(() => post(app, { platform: true }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE, idempotencyKey: `${RUN}-z1`, requestFingerprint: "f", fingerprintVersion: 1,
      legs: [{ accountId: ACC.platCashUsd, amountMicros: 10 }],
    }))).toBe("LG001"));

  it("rejects a zero-value leg (LG032)", async () =>
    expect(await pgCode(() => post(app, { platform: true }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE, idempotencyKey: `${RUN}-zv`, requestFingerprint: "f", fingerprintVersion: 1,
      legs: [{ accountId: ACC.platCashUsd, amountMicros: 0 }, { accountId: ACC.platRevUsd, amountMicros: 0 }],
    }))).toBe("LG032"));

  it("rejects unbalanced legs (LG002)", async () =>
    expect(await pgCode(() => post(app, { platform: true }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE, idempotencyKey: `${RUN}-ub`, requestFingerprint: "f", fingerprintVersion: 1,
      legs: [{ accountId: ACC.platCashUsd, amountMicros: 10 }, { accountId: ACC.platRevUsd, amountMicros: -9 }],
    }))).toBe("LG002"));

  it("rejects an amount above +1e15 (LG032)", async () =>
    expect(await pgCode(() => post(app, { platform: true }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE, idempotencyKey: `${RUN}-ob`, requestFingerprint: "f", fingerprintVersion: 1,
      legs: [{ accountId: ACC.platCashUsd, amountMicros: 1_000_000_000_000_001 }, { accountId: ACC.platRevUsd, amountMicros: -1_000_000_000_000_001 }],
    }))).toBe("LG032"));

  it("rejects MIN-BIGINT (−2^63) (LG032)", async () => {
    const payload = `{"operation":"fund","currency":"USD","effectiveAt":"${EFFECTIVE}","idempotencyKey":"${RUN}-min","requestFingerprint":"f","fingerprintVersion":1,"legs":[{"accountId":"${ACC.platCashUsd}","amountMicros":-9223372036854775808},{"accountId":"${ACC.platRevUsd}","amountMicros":9223372036854775808}]}`;
    const code = await pgCode(() => app.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT set_config('app.is_platform','on',true)`);
      await tx.$queryRawUnsafe(`SELECT billing.ledger_post($1::jsonb)`, payload);
    }));
    expect(code).toBe("LG032");
  });

  it("rejects an unknown account reference (LG033)", async () =>
    expect(await pgCode(() => post(app, { platform: true }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE, idempotencyKey: `${RUN}-noacc`, requestFingerprint: "f", fingerprintVersion: 1,
      legs: [{ accountId: "00000000-0000-7000-8000-00000000dead", amountMicros: 10 }, { accountId: ACC.platRevUsd, amountMicros: -10 }],
    }))).toBe("LG033"));

  it("rejects a currency mismatch between leg account and transaction (LG003)", async () =>
    expect(await pgCode(() => post(app, { platform: true }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE, idempotencyKey: `${RUN}-cur`, requestFingerprint: "f", fingerprintVersion: 1,
      legs: [{ accountId: ACC.platEur, amountMicros: 10 }, { accountId: ACC.platRevUsd, amountMicros: -10 }],
    }))).toBe("LG003"));

  it("rejects cross-tenant posting (another tenant's account) (LG004)", async () =>
    expect(await pgCode(() => post(app, { tenantId: TA }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE, ownerTenantId: TA, idempotencyKey: `${RUN}-xt`, requestFingerprint: "f", fingerprintVersion: 1,
      legs: [{ accountId: ACC.taAsset, amountMicros: 10 }, { accountId: ACC.tbLiab, amountMicros: -10 }],
    }))).toBe("LG004"));

  it("rejects an empty operation (LG031)", async () =>
    expect(await pgCode(() => post(app, { platform: true }, {
      operation: "", currency: "USD", effectiveAt: EFFECTIVE, idempotencyKey: `${RUN}-op`, requestFingerprint: "f", fingerprintVersion: 1,
      legs: [{ accountId: ACC.platCashUsd, amountMicros: 10 }, { accountId: ACC.platRevUsd, amountMicros: -10 }],
    }))).toBe("LG031"));
});

describe("13-1 ledger — authorization (trusted context, not payload)", () => {
  it("rejects a tenant posting when the session context does not match the owner (LG030)", async () =>
    expect(await pgCode(() => post(app, { tenantId: TB }, {
      operation: "fund", currency: "USD", effectiveAt: EFFECTIVE, ownerTenantId: TA, idempotencyKey: `${RUN}-imp`, requestFingerprint: "f", fingerprintVersion: 1,
      legs: [{ accountId: ACC.taAsset, amountMicros: 10 }, { accountId: ACC.taLiab, amountMicros: -10 }],
    }))).toBe("LG030"));

  it("rejects a platform posting without platform authority in the context (LG030)", async () =>
    expect(await pgCode(() => post(app, { tenantId: TA }, balanced(`${RUN}-noplat`)))).toBe("LG030"));

  it("rejects an idempotency conflict — same key, different payload (LG020)", async () => {
    const k = `${RUN}-conflict`;
    await post(app, { platform: true }, balanced(k, 10));
    expect(await pgCode(() => post(app, { platform: true }, balanced(k, 20)))).toBe("LG020");
  });
});

describe("13-1 ledger — immutability (direct DML as the table owner still fires triggers)", () => {
  let txn = "";
  let legId = "";
  beforeAll(async () => {
    txn = await post(app, { platform: true }, balanced(`${RUN}-immutable`));
    const legs = (await fix.$queryRawUnsafe(`SELECT "id"::text FROM "LedgerLeg" WHERE "transactionId"=$1::uuid LIMIT 1`, txn)) as Array<{ id: string }>;
    legId = legs[0].id;
  });

  it("rejects UPDATE of a posted transaction (LG010)", async () =>
    expect(await pgCode(() => fix.$executeRawUnsafe(`UPDATE "LedgerTransaction" SET "operation"='x' WHERE "id"=$1::uuid`, txn))).toBe("LG010"));
  it("rejects DELETE of a posted transaction (LG010)", async () =>
    expect(await pgCode(() => fix.$executeRawUnsafe(`DELETE FROM "LedgerTransaction" WHERE "id"=$1::uuid`, txn))).toBe("LG010"));
  it("rejects UPDATE of a posted leg (LG010)", async () =>
    expect(await pgCode(() => fix.$executeRawUnsafe(`UPDATE "LedgerLeg" SET "amountMicros"=1 WHERE "id"=$1::uuid`, legId))).toBe("LG010"));
  it("rejects DELETE of a posted leg (LG010)", async () =>
    expect(await pgCode(() => fix.$executeRawUnsafe(`DELETE FROM "LedgerLeg" WHERE "id"=$1::uuid`, legId))).toBe("LG010"));
  it("rejects a late leg inserted into an existing transaction (LG010)", async () =>
    expect(await pgCode(() => fix.$executeRawUnsafe(
      `INSERT INTO "LedgerLeg"("id","transactionId","accountId","currency","amountMicros") VALUES (uuidv7(),$1::uuid,$2::uuid,'USD',5)`, txn, ACC.platCashUsd,
    ))).toBe("LG010"));

  it("rejects mutation of immutable account identity — currency (LG011)", async () =>
    expect(await pgCode(() => fix.$executeRawUnsafe(`UPDATE "LedgerAccount" SET "currency"='EUR' WHERE "id"=$1::uuid`, ACC.platCashUsd))).toBe("LG011"));
  it("rejects mutation of immutable account identity — type (LG011)", async () =>
    expect(await pgCode(() => fix.$executeRawUnsafe(`UPDATE "LedgerAccount" SET "type"='LIABILITY' WHERE "id"=$1::uuid`, ACC.platCashUsd))).toBe("LG011"));
  it("allows a descriptive-name update on an account", async () => {
    await fix.$executeRawUnsafe(`UPDATE "LedgerAccount" SET "name"='renamed' WHERE "id"=$1::uuid`, ACC.platRevUsd);
    const r = (await fix.$queryRawUnsafe(`SELECT "name" FROM "LedgerAccount" WHERE "id"=$1::uuid`, ACC.platRevUsd)) as Array<{ name: string }>;
    expect(r[0].name).toBe("renamed");
  });

  it("rejects UPDATE of a completed idempotency key (LG012)", async () =>
    expect(await pgCode(() => fix.$executeRawUnsafe(
      `UPDATE "IdempotencyKey" SET "requestFingerprint"='x' WHERE "operation"='fund' AND "key"=$1`, `${RUN}-immutable`,
    ))).toBe("LG012"));
  it("rejects DELETE of a completed idempotency key (LG012)", async () =>
    expect(await pgCode(() => fix.$executeRawUnsafe(
      `DELETE FROM "IdempotencyKey" WHERE "operation"='fund' AND "key"=$1`, `${RUN}-immutable`,
    ))).toBe("LG012"));
});

describe("13-1 ledger — deferred integrity on direct DML (COMMIT-time)", () => {
  it("rejects an incomplete idempotency claim at COMMIT (LG005 — completed without result)", async () =>
    expect(await pgMsg(() => fix.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "IdempotencyKey"("id","tenantId","operation","key","requestFingerprint","fingerprintVersion","resultTransactionId") VALUES (uuidv7(),NULL,'fund',$1,'f',1,NULL)`,
        `${RUN}-incomplete`,
      );
      // no finalize → deferred completeness trigger must reject at COMMIT
    }))).toContain("committed without a result transaction"));

  it("rejects a header with zero legs at COMMIT (fewer than two legs); leaves no transaction", async () => {
    const before = (await fix.$queryRawUnsafe(`SELECT count(*)::int n FROM "LedgerTransaction"`)) as Array<{ n: number }>;
    const msg = await pgMsg(() => fix.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "LedgerTransaction"("id","operation","ownerTenantId","currency","effectiveAt") VALUES (uuidv7(),'fund',NULL,'USD',now())`,
      );
    }));
    expect(msg).toContain("fewer than two non-zero legs");
    const after = (await fix.$queryRawUnsafe(`SELECT count(*)::int n FROM "LedgerTransaction"`)) as Array<{ n: number }>;
    expect(after[0].n).toBe(before[0].n); // atomic rollback — no header escaped
  });

  it("rejects an unbalanced transaction inserted directly, at COMMIT (unbalanced)", async () =>
    expect(await pgMsg(() => fix.$transaction(async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `INSERT INTO "LedgerTransaction"("id","operation","ownerTenantId","currency","effectiveAt") VALUES (uuidv7(),'fund',NULL,'USD',now()) RETURNING "id"`,
      )) as Array<{ id: string }>;
      const t = rows[0].id;
      await tx.$executeRawUnsafe(`INSERT INTO "LedgerLeg"("id","transactionId","accountId","currency","amountMicros") VALUES (uuidv7(),$1::uuid,$2::uuid,'USD',10)`, t, ACC.platCashUsd);
      await tx.$executeRawUnsafe(`INSERT INTO "LedgerLeg"("id","transactionId","accountId","currency","amountMicros") VALUES (uuidv7(),$1::uuid,$2::uuid,'USD',-9)`, t, ACC.platRevUsd);
    }))).toContain("unbalanced"));
});

describe("13-1 ledger — runtime privilege negatives (telvyn_app)", () => {
  it("cannot SELECT a ledger base table directly (42501)", async () =>
    expect(await pgCode(() => app.$queryRawUnsafe(`SELECT 1 FROM "LedgerTransaction" LIMIT 1`))).toBe("42501"));
  it("cannot INSERT a ledger row directly (42501)", async () =>
    expect(await pgCode(() => app.$executeRawUnsafe(`INSERT INTO "LedgerLeg"("id","transactionId","accountId","currency","amountMicros") VALUES (uuidv7(),uuidv7(),uuidv7(),'USD',1)`))).toBe("42501"));
  it("cannot UPDATE a ledger row directly (42501)", async () =>
    expect(await pgCode(() => app.$executeRawUnsafe(`UPDATE "LedgerLeg" SET "amountMicros"=1`))).toBe("42501"));
  it("cannot DELETE a ledger row directly (42501)", async () =>
    expect(await pgCode(() => app.$executeRawUnsafe(`DELETE FROM "LedgerTransaction"`))).toBe("42501"));
  it("cannot TRUNCATE a ledger table (42501)", async () =>
    expect(await pgCode(() => app.$executeRawUnsafe(`TRUNCATE "LedgerLeg"`))).toBe("42501"));
  it("cannot ALTER a ledger table / disable its triggers (42501)", async () =>
    expect(await pgCode(() => app.$executeRawUnsafe(`ALTER TABLE "LedgerTransaction" DISABLE TRIGGER ALL`))).toBe("42501"));
  it("cannot replace the posting function (42501)", async () =>
    expect(await pgCode(() => app.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION billing.ledger_post(jsonb) RETURNS uuid LANGUAGE sql AS $$ SELECT uuidv7() $$`))).toBe("42501"));
  it("cannot SET ROLE to the migrator (42501)", async () =>
    expect(await pgCode(() => app.$executeRawUnsafe(`SET ROLE telvyn_migrator`))).toBe("42501"));
  it("cannot SET ROLE to the function owner (42501)", async () =>
    expect(await pgCode(() => app.$executeRawUnsafe(`SET ROLE telvyn_ledger_fn`))).toBe("42501"));
});

describe("13-1 ledger — concurrency & atomicity", () => {
  it("concurrent identical posts produce exactly one transaction", async () => {
    const k = `${RUN}-cc-same`;
    const [a, b] = await Promise.all([
      post(app, { platform: true }, balanced(k, 7)),
      post(app, { platform: true }, balanced(k, 7)),
    ]);
    expect(a).toBe(b);
    const cnt = (await fix.$queryRawUnsafe(`SELECT count(*)::int n FROM "IdempotencyKey" WHERE "operation"='fund' AND "key"=$1`, k)) as Array<{ n: number }>;
    expect(cnt[0].n).toBe(1);
  });

  it("concurrent same-key different-payload: one commits, the other conflicts (LG020)", async () => {
    const k = `${RUN}-cc-diff`;
    const results = await Promise.allSettled([
      post(app, { platform: true }, balanced(k, 11)),
      post(app, { platform: true }, balanced(k, 22)),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const rej = results.filter((r) => r.status === "rejected");
    expect(ok).toBe(1);
    expect(rej.length).toBe(1);
  });

  it("after a rolled-back claim, the same key can still be posted (new transaction)", async () => {
    const k = `${RUN}-cc-rollback`;
    // First attempt claims then forces a rollback.
    await expect(app.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT set_config('app.is_platform','on',true)`);
      await tx.$queryRawUnsafe(`SELECT billing.ledger_post($1::jsonb)`, JSON.stringify(balanced(k, 5)));
      throw new Error("force-rollback");
    })).rejects.toThrow("force-rollback");
    // Second attempt succeeds (the claim did not persist).
    const id = await post(app, { platform: true }, balanced(k, 5));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
