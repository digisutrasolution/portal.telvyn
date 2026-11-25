/**
 * Phase 13-1E — deterministic concurrency + connection-isolation integration
 * (F03-A/B/C, F04) for LedgerPostingService against real PostgreSQL 18.
 *
 * Uses independent PrismaClient connections and a hold-and-release barrier. A real
 * conflict is proven with DIRECT PostgreSQL evidence — the waiting writer is a
 * distinct backend (pg_backend_pid) blocked specifically BY the holder
 * (pg_blocking_pids), observed via bounded polling — never by `bDone===false`
 * timing alone; success is then asserted by committed-state invariants.
 * Fixtures/verification use the privileged
 * migrator connection; posts run as telvyn_app. No migrations; immutable history
 * preserved (run-unique namespaces, nothing deleted).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Currency, PrismaClient } from "@prisma/client";
import { fixturePrisma } from "./fixture-db";
import { PrismaService } from "@/infra/prisma.service";
import { parseDecimalToMicros } from "@/billing/money";
import { type LedgerOwner, type LedgerPostInput, createTrustedLedgerContext } from "@/billing/ledger-contract";
import { LedgerPostingService } from "@/billing/ledger-posting.service";

const fix = fixturePrisma;
const appA = new PrismaService();
const appB = new PrismaService(); // independent connection/pool
const svcA = new LedgerPostingService(appA);
const svcB = new LedgerPostingService(appB);

const RUN = `131e-${Date.now().toString(36)}`;
const ACC: Record<string, string> = {};
let TA = "";
let TB = "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}
const platformCtx = () => createTrustedLedgerContext({ owner: { kind: "platform" } as LedgerOwner, actorId: null, operation: "fund" });
const tenantCtx = (tid: string) => createTrustedLedgerContext({ owner: { kind: "tenant", tenantId: tid }, actorId: null, operation: "fund" });

function pInput(key: string, decimal = "1"): LedgerPostInput {
  return {
    currency: Currency.USD, effectiveAt: new Date("2026-11-25T00:00:00Z"), idempotencyKey: key,
    legs: [
      { accountId: ACC.platCash, amountMicros: parseDecimalToMicros(decimal) },
      { accountId: ACC.platRev, amountMicros: parseDecimalToMicros(`-${decimal}`) },
    ],
  };
}
async function mk(key: string, tenantId: string | null, code: string, type: "ASSET" | "LIABILITY" | "REVENUE", nb: "DEBIT" | "CREDIT") {
  ACC[key] = (await fix.ledgerAccount.create({ data: { tenantId, currency: Currency.USD, code, name: code, type, normalBalance: nb } })).id;
}
async function completedClaims(key: string): Promise<number> {
  const r = (await fix.$queryRawUnsafe(`SELECT count(*)::int n FROM "IdempotencyKey" WHERE "operation"='fund' AND "key"=$1 AND "resultTransactionId" IS NOT NULL`, key)) as Array<{ n: number }>;
  return r[0].n;
}
async function legCount(txId: string): Promise<{ n: number; s: string }> {
  const r = (await fix.$queryRawUnsafe(`SELECT count(*)::int n, coalesce(sum("amountMicros"::numeric),0)::text s FROM "LedgerLeg" WHERE "transactionId"=$1::uuid`, txId)) as Array<{ n: number; s: string }>;
  return r[0];
}
async function txnOwner(id: string): Promise<string | null> {
  const r = (await fix.$queryRawUnsafe(`SELECT "ownerTenantId"::text o FROM "LedgerTransaction" WHERE "id"=$1::uuid`, id)) as Array<{ o: string | null }>;
  return r[0]?.o ?? null;
}

/** Every backend (other than the caller) and the pids currently blocking each,
 *  read from the privileged connection. pg_blocking_pids() is callable by any
 *  role and reports lock blockers regardless of per-row column visibility. */
async function blockingSnapshot(): Promise<Array<{ pid: number; blockers: number[] }>> {
  const rows = (await fix.$queryRawUnsafe(
    `SELECT pid::int AS pid, array_to_string(pg_blocking_pids(pid), ',') AS blockers
       FROM pg_stat_activity WHERE pid <> pg_backend_pid()`,
  )) as Array<{ pid: number; blockers: string | null }>;
  return rows.map((r) => ({ pid: r.pid, blockers: (r.blockers ?? "").split(",").filter(Boolean).map(Number) }));
}
/** Bounded poll for a distinct backend blocked specifically BY blockerPid (direct
 *  lock-contention evidence — not a timing heuristic). Throws if none appears. */
async function waitForBlockedBy(blockerPid: number, timeoutMs = 8000): Promise<{ pid: number; blockers: number[] }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = (await blockingSnapshot()).find((r) => r.pid !== blockerPid && r.blockers.includes(blockerPid));
    if (hit) return hit;
    if (Date.now() >= deadline) throw new Error(`no backend observed blocked by pid ${blockerPid} within ${timeoutMs}ms`);
    await sleep(50);
  }
}

beforeAll(async () => {
  TA = (await fix.tenant.create({ data: { slug: `${RUN}-ta`, name: `${RUN}-ta`, type: "CUSTOMER" } })).id;
  TB = (await fix.tenant.create({ data: { slug: `${RUN}-tb`, name: `${RUN}-tb`, type: "CUSTOMER" } })).id;
  await mk("platCash", null, `${RUN}-PCASH`, "ASSET", "DEBIT");
  await mk("platRev", null, `${RUN}-PREV`, "REVENUE", "CREDIT");
  await mk("taA", TA, `${RUN}-TAA`, "ASSET", "DEBIT");
  await mk("taL", TA, `${RUN}-TAL`, "LIABILITY", "CREDIT");
  await mk("tbA", TB, `${RUN}-TBA`, "ASSET", "DEBIT");
  await mk("tbL", TB, `${RUN}-TBL`, "LIABILITY", "CREDIT");
}, 60_000);

afterAll(async () => {
  await Promise.all([appA.$disconnect(), appB.$disconnect()]);
});

describe("F03-A — concurrent platform duplicates resolve to ONE transaction", () => {
  it("B is a distinct backend blocked BY A (pg_blocking_pids), then replays A's committed transaction", async () => {
    const key = `${RUN}-ccdup`;
    const claimed = deferred<number>(); // resolves with A's backend pid
    const release = deferred();
    let aPid = 0;
    const aRun = appA.$transaction(async (tx) => {
      const r = await svcA.postInTransaction(tx, platformCtx(), pInput(key));
      aPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      claimed.resolve(aPid);
      await release.promise; // hold the claim open, then commit when the callback returns
      return r.transactionId;
    }, { timeout: 20_000 });
    await claimed.promise;
    let bDone = false;
    const bRun = svcB.post(platformCtx(), pInput(key)).then((r) => { bDone = true; return r; });
    // DIRECT contention evidence: a distinct backend is blocked specifically BY A.
    const blocked = await waitForBlockedBy(aPid);
    expect(blocked.pid).not.toBe(aPid); // B is an independent physical connection
    expect(blocked.blockers).toContain(aPid); // A is B's blocker (pg_blocking_pids)
    expect(bDone).toBe(false); // corroborating: B has not resolved
    expect(await completedClaims(key)).toBe(0); // A's claim is uncommitted → invisible to others
    release.resolve(); // A commits
    const aId = await aRun;
    const bRes = await bRun;
    expect(bRes.transactionId).toBe(aId); // both resolve the same UUID
    expect(await completedClaims(key)).toBe(1); // exactly one completed claim
    expect(await legCount(aId)).toEqual({ n: 2, s: "0" }); // exactly one balanced leg set
  }, 40_000);
});

describe("F03-B — uncertain-commit recovery (simulated result loss, NOT a real network partition)", () => {
  it("reissuing the same key+payload after a committed post returns the original transaction", async () => {
    const key = `${RUN}-uncertain`;
    const r1 = await svcA.post(platformCtx(), pInput(key));
    // simulate the caller losing r1 (no automatic retry performed by the service)
    const r2 = await svcA.post(platformCtx(), pInput(key));
    expect(r2.transactionId).toBe(r1.transactionId);
    expect(await completedClaims(key)).toBe(1);
    expect(await legCount(r1.transactionId)).toEqual({ n: 2, s: "0" });
  });
});

describe("F03-C — waiting-writer rollback (the blocked writer then succeeds)", () => {
  it("A claims, B is blocked BY A (pg_blocking_pids), A rolls back, B commits — one result, no orphans", async () => {
    const key = `${RUN}-waitroll`;
    const claimed = deferred<number>();
    const release = deferred();
    let aPid = 0;
    const aRun = appA
      .$transaction(async (tx) => {
        await svcA.postInTransaction(tx, platformCtx(), pInput(key));
        aPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
        claimed.resolve(aPid);
        await release.promise;
        throw new Error("rollback-A");
      }, { timeout: 20_000 })
      .then(() => "committed", (e: Error) => (e.message.includes("rollback-A") ? "rolledback" : Promise.reject(e)));
    await claimed.promise;
    let bDone = false;
    const bRun = svcB.post(platformCtx(), pInput(key)).then((r) => { bDone = true; return r; });
    const blocked = await waitForBlockedBy(aPid); // B is blocked specifically BY A
    expect(blocked.pid).not.toBe(aPid); // independent physical connection
    expect(blocked.blockers).toContain(aPid);
    expect(bDone).toBe(false); // corroborating
    release.resolve(); // A rolls back → B's claim proceeds
    expect(await aRun).toBe("rolledback");
    const bRes = await bRun;
    expect(await completedClaims(key)).toBe(1); // exactly one completed claim (B's)
    expect(await legCount(bRes.transactionId)).toEqual({ n: 2, s: "0" }); // balanced, no orphans
  }, 40_000);
});

describe("F04 — transaction-local context isolation on connection reuse", () => {
  it("uses one physical connection and never leaks a stale GUC into a later posting", async () => {
    const url = `${process.env.DATABASE_URL}&connection_limit=1`;
    const single = new PrismaClient({ datasources: { db: { url } } });
    const svc = new LedgerPostingService(single as unknown as PrismaService);
    try {
      const pid0 = (await single.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;

      // tenant post → committed; same connection; GUC reverts after the tx
      const ta = await svc.post(tenantCtx(TA), { currency: Currency.USD, effectiveAt: new Date("2026-11-25T00:00:00Z"), idempotencyKey: `${RUN}-s-ta`, legs: [{ accountId: ACC.taA, amountMicros: parseDecimalToMicros("1") }, { accountId: ACC.taL, amountMicros: parseDecimalToMicros("-1") }] });
      expect(await txnOwner(ta.transactionId)).toBe(TA);
      const after1 = (await single.$queryRaw<Array<{ t: string | null; p: string | null; a: string | null; pid: number }>>`SELECT current_setting('app.tenant_id', true) AS t, current_setting('app.is_platform', true) AS p, current_setting('app.actor_id', true) AS a, pg_backend_pid() AS pid`)[0];
      expect(after1.pid).toBe(pid0); // single physical connection reused
      expect(after1.t === null || after1.t === "").toBe(true); // transaction-local → no stale tenant value
      expect(after1.p === null || after1.p === "" || after1.p === "off").toBe(true);

      // platform post on the SAME connection → owner null (no leak from the tenant tx)
      const p1 = await svc.post(platformCtx(), pInput(`${RUN}-s-p1`));
      expect(await txnOwner(p1.transactionId)).toBeNull();

      // rollback a tenant-B post, then platform again → still null owner, GUC reverted
      await expect(single.$transaction(async (tx) => {
        await svc.postInTransaction(tx as unknown as import("@prisma/client").Prisma.TransactionClient, tenantCtx(TB), { currency: Currency.USD, effectiveAt: new Date("2026-11-25T00:00:00Z"), idempotencyKey: `${RUN}-s-tb-rb`, legs: [{ accountId: ACC.tbA, amountMicros: parseDecimalToMicros("1") }, { accountId: ACC.tbL, amountMicros: parseDecimalToMicros("-1") }] });
        throw new Error("rb");
      })).rejects.toThrow("rb");
      const afterRb = (await single.$queryRaw<Array<{ t: string | null }>>`SELECT current_setting('app.tenant_id', true) AS t`)[0];
      expect(afterRb.t === null || afterRb.t === "").toBe(true); // reverted after rollback — no stale value
      const p2 = await svc.post(platformCtx(), pInput(`${RUN}-s-p2`));
      expect(await txnOwner(p2.transactionId)).toBeNull();

      // then a different tenant (B) commits with the correct owner
      const tb = await svc.post(tenantCtx(TB), { currency: Currency.USD, effectiveAt: new Date("2026-11-25T00:00:00Z"), idempotencyKey: `${RUN}-s-tb`, legs: [{ accountId: ACC.tbA, amountMicros: parseDecimalToMicros("1") }, { accountId: ACC.tbL, amountMicros: parseDecimalToMicros("-1") }] });
      expect(await txnOwner(tb.transactionId)).toBe(TB);

      // DIRECT tenant A → tenant B adjacency on the SAME connection (no intervening
      // platform post): proves no stale tenant GUC from A's tx authorizes B's.
      const taDirect = await svc.post(tenantCtx(TA), { currency: Currency.USD, effectiveAt: new Date("2026-11-25T00:00:00Z"), idempotencyKey: `${RUN}-s-tad`, legs: [{ accountId: ACC.taA, amountMicros: parseDecimalToMicros("1") }, { accountId: ACC.taL, amountMicros: parseDecimalToMicros("-1") }] });
      expect(await txnOwner(taDirect.transactionId)).toBe(TA);
      const betweenAB = (await single.$queryRaw<Array<{ t: string | null }>>`SELECT current_setting('app.tenant_id', true) AS t`)[0];
      expect(betweenAB.t === null || betweenAB.t === "").toBe(true); // reverted between A and B
      const tbDirect = await svc.post(tenantCtx(TB), { currency: Currency.USD, effectiveAt: new Date("2026-11-25T00:00:00Z"), idempotencyKey: `${RUN}-s-tbd`, legs: [{ accountId: ACC.tbA, amountMicros: parseDecimalToMicros("1") }, { accountId: ACC.tbL, amountMicros: parseDecimalToMicros("-1") }] });
      expect(await txnOwner(tbDirect.transactionId)).toBe(TB); // owner is B, never a stale A
    } finally {
      await single.$disconnect();
    }
  }, 30_000);

  it("rejects a forged context (missing provenance) with no DB effect", async () => {
    await expect(svcA.post({ owner: { kind: "platform" }, actorId: null, operation: "fund" } as never, pInput(`${RUN}-forged`))).rejects.toMatchObject({ kind: "MISSING_AUTHORIZATION_CONTEXT" });
  });

  it("rejects a missing context (null / undefined) with no DB effect", async () => {
    await expect(svcA.post(null as never, pInput(`${RUN}-null`))).rejects.toMatchObject({ kind: "MISSING_AUTHORIZATION_CONTEXT" });
    await expect(svcA.post(undefined as never, pInput(`${RUN}-undef`))).rejects.toMatchObject({ kind: "MISSING_AUTHORIZATION_CONTEXT" });
  });
});
