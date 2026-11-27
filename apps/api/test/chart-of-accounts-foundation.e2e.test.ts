/**
 * Phase 13-2B, Slice S4 — Chart of Accounts foundation: invariant tests.
 *
 * ADR-0022 Amendment 5 BA-10 (+ BA-03/BA-04) and owner decisions D1–D6
 * (2026-11-28). Runs against the real PostgreSQL 18 schema with two roles:
 *   - fixture (telvyn_migrator) — the table owner. It calls
 *     billing.ledger_account_open through its privilege-neutral EXECUTE grant,
 *     so the function body really runs as its SECURITY DEFINER owner
 *     (telvyn_ledger_fn) with that role's column-scoped privileges; it also
 *     drives the raw invariants by direct SQL (triggers and CHECKs fire for
 *     owners too);
 *   - runtime (telvyn_app) — S4 is INERT: it must NOT execute the function nor
 *     write LedgerAccount (42501).
 *
 * Raw SQL throughout, so failures surface as Prisma P2010 with meta.code = the
 * PostgreSQL SQLSTATE (LA0xx / LG011 custom; 23xxx / 42501 standard). Rows are
 * never deleted (FK RESTRICT); RUN-unique namespaces keep the database re-runnable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { fixturePrisma } from "./fixture-db";

const fix = fixturePrisma;
const app = new PrismaClient();
// Two further independent owner connections for the concurrency proofs.
const c1 = new PrismaClient({ datasources: { db: { url: process.env.E2E_FIXTURE_DATABASE_URL as string } } });
const c2 = new PrismaClient({ datasources: { db: { url: process.env.E2E_FIXTURE_DATABASE_URL as string } } });

const RUN = `s4-${Date.now().toString(36)}`;
let seq = 0;
const uniq = (p: string) => `${RUN}-${p}-${++seq}`;
const UNKNOWN = "00000000-0000-7000-8000-000000000000";
const TX = { timeout: 20_000, maxWait: 10_000 };

type Cur = "USD" | "EUR";
type Db = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;

async function pgCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e: unknown) {
    const err = e as { code?: string; meta?: { code?: string } };
    if (err.meta?.code) return err.meta.code;
    return `NO_META_CODE(${err.code ?? "?"})`;
  }
  return "NO_ERROR";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

async function newBillingAccount(
  tenantId: string,
  o: { currency?: Cur; mode?: "PREPAID" | "POSTPAID" } = {},
): Promise<{ id: string; num: string }> {
  const num = uniq("ACCT");
  const r = await fix.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "BillingAccount"
       ("tenantId","accountNumber","label","currency","mode","provisioningKey","provisioningFingerprint","updatedAt")
     VALUES ($1::uuid, $2, $3, $4::"Currency", $5::"BillingMode", $6, 'fp-v1', now())
     RETURNING "id"`,
    tenantId,
    num,
    uniq("label"),
    o.currency ?? "USD",
    o.mode ?? "PREPAID",
    uniq("pk"),
  );
  return { id: r[0].id, num };
}

function setStatus(db: Db, baId: string, status: string) {
  return db.$executeRawUnsafe(
    `UPDATE "BillingAccount" SET "status" = $2::"BillingAccountStatus" WHERE "id" = $1::uuid`,
    baId,
    status,
  );
}

/** Calls the opening function inside one transaction of `client`, optionally
 *  with the trusted platform context (app.is_platform = on, transaction-local). */
async function openIn(
  tx: Db,
  baId: string | null,
  tenantId: string | null,
  currency: Cur | null,
  taxonomy: string | null,
  ctx: "platform" | "tenant" | "none" = "platform",
): Promise<string> {
  if (ctx === "platform") await tx.$queryRawUnsafe(`SELECT set_config('app.is_platform', 'on', true)`);
  if (ctx === "tenant" && tenantId) await tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
  const r = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT billing.ledger_account_open($1::uuid, $2::uuid, $3::"Currency", $4) AS id`,
    baId,
    tenantId,
    currency,
    taxonomy,
  );
  return r[0].id;
}
function open(
  client: PrismaClient,
  baId: string | null,
  tenantId: string | null,
  currency: Cur | null,
  taxonomy: string | null = "customer_funds",
  ctx: "platform" | "tenant" | "none" = "platform",
): Promise<string> {
  return client.$transaction((tx) => openIn(tx, baId, tenantId, currency, taxonomy, ctx), TX);
}

function insertLedgerAccount(a: {
  tenantId: string | null;
  currency?: Cur;
  code: string;
  type?: string;
  normalBalance?: string;
  billingAccountId?: string | null;
}) {
  return fix.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "LedgerAccount" ("tenantId","currency","code","name","type","normalBalance","billingAccountId")
     VALUES ($1::uuid, $2::"Currency", $3, $3, $4::"LedgerAccountType", $5::"LedgerNormalBalance", $6::uuid)
     RETURNING "id"`,
    a.tenantId,
    a.currency ?? "USD",
    a.code,
    a.type ?? "LIABILITY",
    a.normalBalance ?? "CREDIT",
    a.billingAccountId ?? null,
  );
}

async function linkedAccounts(baId: string) {
  return fix.$queryRawUnsafe<
    Array<{ id: string; tenantId: string; currency: string; code: string; name: string; type: string; nb: string; status: string }>
  >(
    `SELECT "id", "tenantId"::text AS "tenantId", "currency"::text AS currency, "code", "name",
            "type"::text AS type, "normalBalance"::text AS nb, "status"::text AS status
       FROM "LedgerAccount" WHERE "billingAccountId" = $1::uuid`,
    baId,
  );
}

async function blockedBy(blockerPid: number, timeoutMs = 8000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await fix.$queryRawUnsafe<Array<{ pid: number; blockers: string | null }>>(
      `SELECT pid::int AS pid, array_to_string(pg_blocking_pids(pid), ',') AS blockers
         FROM pg_stat_activity WHERE pid <> pg_backend_pid()`,
    );
    const hit = rows.find((r) => r.pid !== blockerPid && (r.blockers ?? "").split(",").map(Number).includes(blockerPid));
    if (hit) return hit.pid;
    if (Date.now() >= deadline) throw new Error(`no backend observed blocked by pid ${blockerPid} within ${timeoutMs}ms`);
    await sleep(50);
  }
}
const pidOf = async (tx: Db) => (await tx.$queryRawUnsafe<Array<{ pid: number }>>(`SELECT pg_backend_pid() AS pid`))[0].pid;

let TA = "";
let TB = "";

beforeAll(async () => {
  TA = (await fix.tenant.create({ data: { slug: `${RUN}-ta`, name: `${RUN}-ta`, type: "CUSTOMER" } })).id;
  TB = (await fix.tenant.create({ data: { slug: `${RUN}-tb`, name: `${RUN}-tb`, type: "CUSTOMER" } })).id;
}, 60_000);

afterAll(async () => {
  await Promise.all([app.$disconnect(), c1.$disconnect(), c2.$disconnect()]);
});

describe("D1 — the customer_funds taxonomy", () => {
  it("opens exactly one LIABILITY/CREDIT account coded customer_funds:<accountNumber>, with no ledger posting", async () => {
    const ba = await newBillingAccount(TA);
    const id = await open(fix, ba.id, TA, "USD");
    const rows = await linkedAccounts(ba.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      tenantId: TA,
      currency: "USD",
      code: `customer_funds:${ba.num}`,
      type: "LIABILITY",
      nb: "CREDIT",
      status: "ACTIVE",
    });
    // Opening never creates a (zero-value) ledger transaction, leg or idempotency row.
    const n = await fix.$queryRawUnsafe<Array<{ legs: number; txns: number; keys: number }>>(
      `SELECT (SELECT count(*)::int FROM "LedgerLeg" WHERE "accountId" = $1::uuid) AS legs,
              (SELECT count(*)::int FROM "LedgerTransaction" WHERE "ownerTenantId" = $2::uuid) AS txns,
              (SELECT count(*)::int FROM "IdempotencyKey" WHERE "tenantId" = $2::uuid) AS keys`,
      id,
      TA,
    );
    expect(n[0]).toEqual({ legs: 0, txns: 0, keys: 0 });
  });
  it("rejects any other taxonomy (LA007) — postpaid receivables are not implemented", async () => {
    const ba = await newBillingAccount(TA);
    expect(await pgCode(() => open(fix, ba.id, TA, "USD", "receivable_unbilled"))).toBe("LA007");
    expect(await pgCode(() => open(fix, ba.id, TA, "USD", "Customer_Funds"))).toBe("LA007");
    expect(await linkedAccounts(ba.id)).toHaveLength(0);
  });
  it("rejects missing arguments (LA031)", async () => {
    const ba = await newBillingAccount(TA);
    expect(await pgCode(() => open(fix, null, TA, "USD"))).toBe("LA031");
    expect(await pgCode(() => open(fix, ba.id, null, "USD"))).toBe("LA031");
    expect(await pgCode(() => open(fix, ba.id, TA, null))).toBe("LA031");
    expect(await pgCode(() => open(fix, ba.id, TA, "USD", null))).toBe("LA031");
  });
});

describe("D3 — lifecycle, ownership and currency preconditions", () => {
  it("requires platform authority in the trusted session context (LA030)", async () => {
    const ba = await newBillingAccount(TA);
    expect(await pgCode(() => open(fix, ba.id, TA, "USD", "customer_funds", "none"))).toBe("LA030");
    expect(await pgCode(() => open(fix, ba.id, TA, "USD", "customer_funds", "tenant"))).toBe("LA030");
    expect(await linkedAccounts(ba.id)).toHaveLength(0);
  });
  it("rejects a POSTPAID billing account (LA002)", async () => {
    const ba = await newBillingAccount(TA, { mode: "POSTPAID" });
    expect(await pgCode(() => open(fix, ba.id, TA, "USD"))).toBe("LA002");
  });
  it.each(["SUSPENDED", "CLOSING", "CLOSED"])("rejects a %s billing account (LA003)", async (status) => {
    const ba = await newBillingAccount(TA);
    if (status === "CLOSED") await setStatus(fix, ba.id, "CLOSING");
    await setStatus(fix, ba.id, status);
    expect(await pgCode(() => open(fix, ba.id, TA, "USD"))).toBe("LA003");
    expect(await linkedAccounts(ba.id)).toHaveLength(0);
  });
  it("rejects another tenant's or an unknown billing account with the same sanitized error (LA001)", async () => {
    const ba = await newBillingAccount(TA);
    expect(await pgCode(() => open(fix, ba.id, TB, "USD"))).toBe("LA001");
    expect(await pgCode(() => open(fix, UNKNOWN, TA, "USD"))).toBe("LA001");
    expect(await linkedAccounts(ba.id)).toHaveLength(0);
  });
  it("rejects a currency mismatch (LA004)", async () => {
    const ba = await newBillingAccount(TA, { currency: "EUR" });
    expect(await pgCode(() => open(fix, ba.id, TA, "USD"))).toBe("LA004");
    await open(fix, ba.id, TA, "EUR");
    expect((await linkedAccounts(ba.id))[0].currency).toBe("EUR");
  });
  it("error messages carry no identifiers", async () => {
    const ba = await newBillingAccount(TA);
    try {
      await open(fix, ba.id, TB, "USD");
      throw new Error("expected rejection");
    } catch (e) {
      const msg = String((e as { meta?: { message?: string } }).meta?.message ?? (e as Error).message);
      expect(msg).toContain("billing account not found for this tenant");
      expect(msg).not.toContain(ba.id);
      expect(msg).not.toContain(TA);
      expect(msg).not.toContain(TB);
    }
  });
});

describe("D4 — database-level uniqueness", () => {
  it("a second open of the same account fails with the stable LA005", async () => {
    const ba = await newBillingAccount(TA);
    await open(fix, ba.id, TA, "USD");
    expect(await pgCode(() => open(fix, ba.id, TA, "USD"))).toBe("LA005");
    expect(await linkedAccounts(ba.id)).toHaveLength(1);
  });
  it("distinct billing accounts of one tenant each get their own account", async () => {
    const a = await newBillingAccount(TA);
    const b = await newBillingAccount(TA);
    await open(fix, a.id, TA, "USD");
    await open(fix, b.id, TA, "USD");
    expect(await linkedAccounts(a.id)).toHaveLength(1);
    expect(await linkedAccounts(b.id)).toHaveLength(1);
  });
  it("uniqueness holds without the function: a direct duplicate insert is rejected (23505)", async () => {
    const ba = await newBillingAccount(TA);
    await open(fix, ba.id, TA, "USD");
    expect(
      await pgCode(() => insertLedgerAccount({ tenantId: TA, code: `customer_funds:${ba.num}`, billingAccountId: ba.id })),
    ).toBe("23505");
    expect(await linkedAccounts(ba.id)).toHaveLength(1);
  });
});

describe("D6 — database enforcement for direct writes (table owner)", () => {
  it("unlinked platform and tenant accounts keep working unchanged (D2 compatibility)", async () => {
    const p = await insertLedgerAccount({ tenantId: null, code: uniq("PLAT"), type: "ASSET", normalBalance: "DEBIT" });
    const t = await insertLedgerAccount({ tenantId: TA, code: uniq("TEN"), type: "ASSET", normalBalance: "DEBIT" });
    expect(p[0].id).toBeTruthy();
    expect(t[0].id).toBeTruthy();
  });
  it("the customer_funds prefix is reserved for linked accounts (23514)", async () => {
    expect(await pgCode(() => insertLedgerAccount({ tenantId: TA, code: `customer_funds:${uniq("X")}` }))).toBe("23514");
    expect(await pgCode(() => insertLedgerAccount({ tenantId: null, code: `customer_funds:${uniq("X")}` }))).toBe("23514");
  });
  it("a link without a tenant owner is rejected", async () => {
    const ba = await newBillingAccount(TA);
    expect(
      await pgCode(() => insertLedgerAccount({ tenantId: null, code: `customer_funds:${ba.num}`, billingAccountId: ba.id })),
    ).toBe("LA001");
  });
  it("cross-tenant and cross-currency links are rejected", async () => {
    const ba = await newBillingAccount(TA);
    expect(
      await pgCode(() => insertLedgerAccount({ tenantId: TB, code: `customer_funds:${ba.num}`, billingAccountId: ba.id })),
    ).toBe("LA001");
    expect(
      await pgCode(() =>
        insertLedgerAccount({ tenantId: TA, currency: "EUR", code: `customer_funds:${ba.num}`, billingAccountId: ba.id }),
      ),
    ).toBe("LA004");
  });
  it("the cross-table code rule and the approved type/normal balance are enforced (LA007)", async () => {
    const ba = await newBillingAccount(TA);
    const other = await newBillingAccount(TA);
    expect(
      await pgCode(() => insertLedgerAccount({ tenantId: TA, code: `customer_funds:${other.num}`, billingAccountId: ba.id })),
    ).toBe("LA007");
    expect(
      await pgCode(() =>
        insertLedgerAccount({ tenantId: TA, code: `customer_funds:${ba.num}`, type: "ASSET", normalBalance: "DEBIT", billingAccountId: ba.id }),
      ),
    ).toBe("LA007");
    expect(
      await pgCode(() =>
        insertLedgerAccount({ tenantId: TA, code: `customer_funds:${ba.num}`, normalBalance: "DEBIT", billingAccountId: ba.id }),
      ),
    ).toBe("LA007");
    expect(await linkedAccounts(ba.id)).toHaveLength(0);
  });
  it("direct inserts still honour the lifecycle (POSTPAID LA002, non-ACTIVE LA003)", async () => {
    const pp = await newBillingAccount(TA, { mode: "POSTPAID" });
    expect(
      await pgCode(() => insertLedgerAccount({ tenantId: TA, code: `customer_funds:${pp.num}`, billingAccountId: pp.id })),
    ).toBe("LA002");
    const su = await newBillingAccount(TA);
    await setStatus(fix, su.id, "SUSPENDED");
    expect(
      await pgCode(() => insertLedgerAccount({ tenantId: TA, code: `customer_funds:${su.num}`, billingAccountId: su.id })),
    ).toBe("LA003");
  });
  it("the link is immutable (LA006) and the existing identity guard still applies (LG011)", async () => {
    const ba = await newBillingAccount(TA);
    const other = await newBillingAccount(TA);
    const id = await open(fix, ba.id, TA, "USD");
    const upd = (sql: string, ...p: unknown[]) =>
      fix.$executeRawUnsafe(`UPDATE "LedgerAccount" SET ${sql} WHERE "id" = $1::uuid`, id, ...p);
    expect(await pgCode(() => upd(`"billingAccountId" = NULL`))).toBe("LA006");
    expect(await pgCode(() => upd(`"billingAccountId" = $2::uuid`, other.id))).toBe("LA006");
    expect(await pgCode(() => upd(`"code" = 'customer_funds:changed'`))).toBe("LG011");
    expect(await pgCode(() => upd(`"tenantId" = $2::uuid`, TB))).toBe("LG011");
    // Descriptive name stays mutable.
    expect(await upd(`"name" = 'Customer funds (renamed)'`)).toBe(1);
    // An unlinked account cannot acquire a link afterwards.
    const plain = await insertLedgerAccount({ tenantId: TA, code: uniq("PLAIN") });
    expect(
      await pgCode(() =>
        fix.$executeRawUnsafe(`UPDATE "LedgerAccount" SET "billingAccountId" = $2::uuid WHERE "id" = $1::uuid`, plain[0].id, other.id),
      ),
    ).toBe("LA006");
  });
  it("a linked billing account cannot be hard-deleted (FK RESTRICT → 23001)", async () => {
    const ba = await newBillingAccount(TA);
    await open(fix, ba.id, TA, "USD");
    expect(await pgCode(() => fix.$executeRawUnsafe(`DELETE FROM "BillingAccount" WHERE "id" = $1::uuid`, ba.id))).toBe("23001");
  });
});

describe("D5 — S4 is inert for the runtime role", () => {
  it("telvyn_app cannot execute the opening function (42501)", async () => {
    const ba = await newBillingAccount(TA);
    expect(await pgCode(() => open(app, ba.id, TA, "USD"))).toBe("42501");
    expect(await linkedAccounts(ba.id)).toHaveLength(0);
  });
  it("telvyn_app cannot write or read LedgerAccount directly (42501)", async () => {
    const ba = await newBillingAccount(TA);
    expect(
      await pgCode(() =>
        app.$executeRawUnsafe(
          `INSERT INTO "LedgerAccount" ("tenantId","currency","code","name","type","normalBalance","billingAccountId")
           VALUES ($1::uuid,'USD',$2,'x','LIABILITY','CREDIT',$3::uuid)`,
          TA,
          `customer_funds:${ba.num}`,
          ba.id,
        ),
      ),
    ).toBe("42501");
    expect(await pgCode(() => app.$queryRawUnsafe(`SELECT 1 FROM "LedgerAccount" LIMIT 1`))).toBe("42501");
  });
});

describe("D3/D4 — concurrency", () => {
  it("concurrent opens of one billing account: exactly one succeeds, the other waits on the row lock then gets LA005", async () => {
    const ba = await newBillingAccount(TA);
    const opened = deferred<number>();
    const release = deferred();
    const aRun = c1.$transaction(async (tx) => {
      const id = await openIn(tx, ba.id, TA, "USD", "customer_funds");
      opened.resolve(await pidOf(tx));
      await release.promise;
      return id;
    }, TX);
    const aPid = await opened.promise;
    const bRun = pgCode(() => open(c2, ba.id, TA, "USD"));
    expect(await blockedBy(aPid)).toBeGreaterThan(0); // B is a distinct backend blocked BY A
    release.resolve();
    const aId = await aRun;
    expect(await bRun).toBe("LA005");
    const rows = await linkedAccounts(ba.id);
    expect(rows.map((r) => r.id)).toEqual([aId]);
  });
  it("a status change committed while an open waits is honoured (LA003): no stale-lifecycle bypass", async () => {
    const ba = await newBillingAccount(TA);
    const locked = deferred<number>();
    const release = deferred();
    const suspend = c1.$transaction(async (tx) => {
      await setStatus(tx, ba.id, "SUSPENDED");
      locked.resolve(await pidOf(tx));
      await release.promise;
    }, TX);
    const sPid = await locked.promise;
    const openRun = pgCode(() => open(c2, ba.id, TA, "USD"));
    expect(await blockedBy(sPid)).toBeGreaterThan(0); // the open's FOR UPDATE waits on the status change
    release.resolve();
    await suspend;
    expect(await openRun).toBe("LA003");
    expect(await linkedAccounts(ba.id)).toHaveLength(0);
  });
  it("a status change attempted during an open waits for it (the lifecycle check holds until COMMIT)", async () => {
    const ba = await newBillingAccount(TA);
    const opened = deferred<number>();
    const release = deferred();
    const openRun = c1.$transaction(async (tx) => {
      const id = await openIn(tx, ba.id, TA, "USD", "customer_funds");
      opened.resolve(await pidOf(tx));
      await release.promise;
      return id;
    }, TX);
    const oPid = await opened.promise;
    const suspend = c2.$transaction((tx) => setStatus(tx, ba.id, "SUSPENDED"), TX);
    expect(await blockedBy(oPid)).toBeGreaterThan(0);
    release.resolve();
    const id = await openRun;
    expect(await suspend).toBe(1);
    // The account was opened while ACTIVE (serialized before the suspension).
    expect((await linkedAccounts(ba.id)).map((r) => r.id)).toEqual([id]);
  });
});
