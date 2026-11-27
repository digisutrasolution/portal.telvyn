/**
 * Phase 13-2B, Slice S3 — BillingAccount database foundation: invariant tests.
 *
 * ADR-0022 Amendment 5 (BA-01/02/04/05/06/13, X-1) + owner S3 decisions
 * S3-D1..D4 and E. Runs against the real PostgreSQL 18 schema with two roles:
 *   - fixture (telvyn_migrator via fixturePrisma) — the table owner; drives every
 *     constraint/index/trigger by direct SQL (the guard trigger fires for owners);
 *   - runtime (telvyn_app via the default DATABASE_URL) — must hold NO privilege
 *     on BillingAccount in S3 (inert foundation, owner decision E).
 *
 * All statements are raw SQL so failures surface as Prisma P2010 with
 * meta.code = the PostgreSQL SQLSTATE (BA0xx custom; 23xxx/42501 standard).
 * Rows are never deleted (FK RESTRICT, no runtime DELETE); RUN-unique namespaces
 * keep the disposable e2e database re-runnable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { fixturePrisma } from "./fixture-db";
import { testAccountNumber, testFingerprint, testProvisioningKey } from "./billing-fixtures";

const fix = fixturePrisma;
const app = new PrismaClient();

const RUN = `s3-${Date.now().toString(36)}`;
let seq = 0;
const uniq = (p: string) => `${RUN}-${p}-${++seq}`;

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

type NewAccount = {
  tenantId: string;
  label?: string;
  currency?: "USD" | "EUR" | "GBP";
  mode?: "PREPAID" | "POSTPAID";
  status?: string;
  isDefault?: boolean;
  successorOfId?: string | null;
  provisioningKey?: string;
  accountNumber?: string;
  id?: string;
};

function insert(client: PrismaClient, a: NewAccount): Promise<string> {
  return client
    .$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "BillingAccount"
         ("id","tenantId","accountNumber","label","currency","mode","status","isDefault",
          "successorOfId","provisioningKey","provisioningFingerprint","updatedAt")
       VALUES (COALESCE($1::uuid, uuidv7()), $2::uuid, $3, $4, $5::"Currency", $6::"BillingMode",
               $7::"BillingAccountStatus", $8, $9::uuid, $10, $11, now())
       RETURNING "id"`,
      a.id ?? null,
      a.tenantId,
      a.accountNumber ?? testAccountNumber(),
      a.label ?? uniq("label"),
      a.currency ?? "USD",
      a.mode ?? "PREPAID",
      a.status ?? "ACTIVE",
      a.isDefault ?? false,
      a.successorOfId ?? null,
      a.provisioningKey ?? testProvisioningKey(uniq("pk")),
      testFingerprint("s3-fixture"),
    )
    .then((r) => r[0].id);
}

function setCol(id: string, col: string, valueSql: string, ...params: unknown[]) {
  return fix.$executeRawUnsafe(`UPDATE "BillingAccount" SET "${col}" = ${valueSql} WHERE "id" = $1::uuid`, id, ...params);
}

async function row(id: string) {
  const r = await fix.$queryRawUnsafe<Array<{ status: string; statusChangedAt: Date; label: string }>>(
    `SELECT "status"::text AS status, "statusChangedAt", "label" FROM "BillingAccount" WHERE "id" = $1::uuid`,
    id,
  );
  return r[0];
}

let TA = "";
let TB = "";
let TR = "";
let TP = "";

beforeAll(async () => {
  TA = (await fix.tenant.create({ data: { slug: `${RUN}-ta`, name: `${RUN}-ta`, type: "CUSTOMER" } })).id;
  TB = (await fix.tenant.create({ data: { slug: `${RUN}-tb`, name: `${RUN}-tb`, type: "CUSTOMER" } })).id;
  TR = (await fix.tenant.create({ data: { slug: `${RUN}-tr`, name: `${RUN}-tr`, type: "RESELLER" } })).id;
  TP = (await fix.tenant.create({ data: { slug: `${RUN}-tp`, name: `${RUN}-tp`, type: "PLATFORM" } })).id;
}, 60_000);

afterAll(async () => {
  await app.$disconnect();
  // Billing accounts and their tenants are FK-RESTRICT protected and intentionally
  // NOT deleted — telvyn_ledger_e2e is disposable.
});

describe("BA-01 ownership", () => {
  it("creates an ACTIVE account for a CUSTOMER and a RESELLER tenant", async () => {
    const a = await insert(fix, { tenantId: TA });
    const r = await insert(fix, { tenantId: TR });
    expect((await row(a)).status).toBe("ACTIVE");
    expect((await row(r)).status).toBe("ACTIVE");
  });
  it("rejects a PLATFORM-tenant owner (BA004)", async () => {
    expect(await pgCode(() => insert(fix, { tenantId: TP }))).toBe("BA004");
  });
  it("rejects an unknown tenant via the FK (23503)", async () => {
    expect(await pgCode(() => insert(fix, { tenantId: "00000000-0000-7000-8000-000000000000" }))).toBe("23503");
  });
  it("blocks hard-deleting a tenant that owns accounts (FK RESTRICT → 23001)", async () => {
    await insert(fix, { tenantId: TB });
    // ON DELETE RESTRICT raises restrict_violation (23001), not the NO ACTION
    // foreign_key_violation (23503) — asserting 23001 proves RESTRICT is in force.
    expect(await pgCode(() => fix.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE "id" = $1::uuid`, TB))).toBe("23001");
  });
});

describe("BA-02 relationships and uniqueness", () => {
  it("allows many accounts per tenant, in the same and different currencies", async () => {
    await insert(fix, { tenantId: TA, currency: "USD" });
    await insert(fix, { tenantId: TA, currency: "USD" });
    await insert(fix, { tenantId: TA, currency: "EUR" });
    const n = await fix.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM "BillingAccount" WHERE "tenantId" = $1::uuid`,
      TA,
    );
    expect(Number(n[0].n)).toBeGreaterThanOrEqual(3);
  });
  it("account number is globally unique (23505)", async () => {
    const num = testAccountNumber();
    await insert(fix, { tenantId: TA, accountNumber: num });
    expect(await pgCode(() => insert(fix, { tenantId: TB, accountNumber: num }))).toBe("23505");
  });
  it("provisioning key is unique per tenant only", async () => {
    const pk = testProvisioningKey(uniq("prov"));
    await insert(fix, { tenantId: TA, provisioningKey: pk });
    expect(await pgCode(() => insert(fix, { tenantId: TA, provisioningKey: pk }))).toBe("23505");
    await expect(insert(fix, { tenantId: TB, provisioningKey: pk })).resolves.toBeTruthy();
  });
});

describe("S3-D1 label", () => {
  it("rejects a blank label (23514)", async () => {
    expect(await pgCode(() => insert(fix, { tenantId: TA, label: "   " }))).toBe("23514");
  });
  it("is unique per tenant ignoring case and surrounding spaces among open accounts", async () => {
    const base = uniq("Main");
    const first = await insert(fix, { tenantId: TA, label: base });
    expect(await pgCode(() => insert(fix, { tenantId: TA, label: `  ${base.toUpperCase()} ` }))).toBe("23505");
    // another tenant may use the same label
    await expect(insert(fix, { tenantId: TB, label: base })).resolves.toBeTruthy();
    // once the holder is CLOSED the label is free again
    await setCol(first, "status", `'CLOSED'::"BillingAccountStatus"`);
    await expect(insert(fix, { tenantId: TA, label: base })).resolves.toBeTruthy();
  });
});

describe("BA-02 default account", () => {
  it("allows at most one ACTIVE/SUSPENDED default per (tenant, currency)", async () => {
    const t = (await fix.tenant.create({ data: { slug: uniq("td"), name: "td", type: "CUSTOMER" } })).id;
    const d1 = await insert(fix, { tenantId: t, currency: "GBP", isDefault: true });
    expect(await pgCode(() => insert(fix, { tenantId: t, currency: "GBP", isDefault: true }))).toBe("23505");
    // a default in another currency is independent
    await expect(insert(fix, { tenantId: t, currency: "EUR", isDefault: true })).resolves.toBeTruthy();
    // SUSPENDED still holds the default slot
    await setCol(d1, "status", `'SUSPENDED'::"BillingAccountStatus"`);
    expect(await pgCode(() => insert(fix, { tenantId: t, currency: "GBP", isDefault: true }))).toBe("23505");
    // CLOSING releases it
    await setCol(d1, "status", `'CLOSING'::"BillingAccountStatus"`);
    await expect(insert(fix, { tenantId: t, currency: "GBP", isDefault: true })).resolves.toBeTruthy();
  });
});

describe("BA-04/BA-05/BA-01 immutable identity (BA001)", () => {
  const cases: Array<[string, string, (ctx: { other: string }) => unknown[]]> = [
    ["currency", `'EUR'::"Currency"`, () => []],
    ["mode", `'POSTPAID'::"BillingMode"`, () => []],
    ["tenantId", `$2::uuid`, ({ other }) => [other]],
    ["accountNumber", `$2`, () => [testAccountNumber()]],
    ["provisioningKey", `$2`, () => [testProvisioningKey(uniq("pk2"))]],
    ["provisioningFingerprint", `$2`, () => [testFingerprint(uniq("fp2"))]],
  ];
  for (const [col, sql, params] of cases) {
    it(`rejects changing ${col}`, async () => {
      const id = await insert(fix, { tenantId: TA });
      expect(await pgCode(() => setCol(id, col, sql, ...params({ other: TB })))).toBe("BA001");
    });
  }
  it("rejects setting or changing the lineage after insert", async () => {
    const root = await insert(fix, { tenantId: TA });
    const other = await insert(fix, { tenantId: TA });
    expect(await pgCode(() => setCol(other, "successorOfId", `$2::uuid`, root))).toBe("BA001");
  });
  it("allows mutable fields (label, isDefault)", async () => {
    const id = await insert(fix, { tenantId: TA });
    await setCol(id, "label", `$2`, uniq("renamed"));
    await setCol(id, "isDefault", `false`);
    expect((await row(id)).status).toBe("ACTIVE");
  });
});

describe("BA-06 / S3-D3 lifecycle (database part)", () => {
  it("a new account must start ACTIVE (BA003)", async () => {
    for (const s of ["SUSPENDED", "CLOSING", "CLOSED"]) {
      expect(await pgCode(() => insert(fix, { tenantId: TA, status: s }))).toBe("BA003");
    }
  });
  it("CLOSED is terminal (BA002); CLOSING→ACTIVE is allowed", async () => {
    const id = await insert(fix, { tenantId: TA });
    await setCol(id, "status", `'CLOSING'::"BillingAccountStatus"`);
    await setCol(id, "status", `'ACTIVE'::"BillingAccountStatus"`);
    await setCol(id, "status", `'CLOSED'::"BillingAccountStatus"`);
    for (const s of ["ACTIVE", "SUSPENDED", "CLOSING"]) {
      expect(await pgCode(() => setCol(id, "status", `'${s}'::"BillingAccountStatus"`))).toBe("BA002");
    }
    expect((await row(id)).status).toBe("CLOSED");
  });
  it("S3-D4: statusChangedAt is stamped on status change and cannot be forged", async () => {
    const id = await insert(fix, { tenantId: TA });
    const t0 = (await row(id)).statusChangedAt.getTime();
    await setCol(id, "statusChangedAt", `'2000-01-01T00:00:00Z'::timestamptz`);
    expect((await row(id)).statusChangedAt.getTime()).toBe(t0);
    await fix.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_sleep(0.01)`);
      await tx.$executeRawUnsafe(
        `UPDATE "BillingAccount" SET "status" = 'SUSPENDED' WHERE "id" = $1::uuid`,
        id,
      );
    });
    expect((await row(id)).statusChangedAt.getTime()).toBeGreaterThan(t0);
  });
});

describe("S3-D2 successor lineage", () => {
  it("allows a same-tenant successor and at most one per account", async () => {
    const root = await insert(fix, { tenantId: TA, mode: "PREPAID" });
    await expect(insert(fix, { tenantId: TA, mode: "POSTPAID", successorOfId: root })).resolves.toBeTruthy();
    expect(await pgCode(() => insert(fix, { tenantId: TA, successorOfId: root }))).toBe("23505");
  });
  it("rejects a cross-tenant successor via the composite FK (23503)", async () => {
    const root = await insert(fix, { tenantId: TA });
    expect(await pgCode(() => insert(fix, { tenantId: TB, successorOfId: root }))).toBe("23503");
  });
  it("rejects self-succession (23514)", async () => {
    const id = "01900000-0000-7000-8000-" + Date.now().toString(16).padStart(12, "0").slice(-12);
    expect(await pgCode(() => insert(fix, { id, tenantId: TA, successorOfId: id }))).toBe("23514");
  });
});

describe("Concurrency — unique indexes serialize racing inserts", () => {
  it("two concurrent default inserts for one (tenant, currency): exactly one wins", async () => {
    const t = (await fix.tenant.create({ data: { slug: uniq("tc"), name: "tc", type: "CUSTOMER" } })).id;
    const res = await Promise.allSettled([
      insert(fix, { tenantId: t, isDefault: true }),
      insert(fix, { tenantId: t, isDefault: true }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as { meta?: { code?: string } }).meta?.code).toBe("23505");
  });
  it("two concurrent inserts with one provisioning key: exactly one wins", async () => {
    const pk = testProvisioningKey(uniq("race"));
    const res = await Promise.allSettled([
      insert(fix, { tenantId: TA, provisioningKey: pk }),
      insert(fix, { tenantId: TA, provisioningKey: pk }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("Owner decision E — runtime role holds NO privilege in S3 (42501)", () => {
  it("telvyn_app cannot SELECT, INSERT, UPDATE or DELETE BillingAccount", async () => {
    expect(await pgCode(() => app.$queryRawUnsafe(`SELECT 1 FROM "BillingAccount" WHERE false`))).toBe("42501");
    expect(await pgCode(() => insert(app, { tenantId: TA }))).toBe("42501");
    expect(await pgCode(() => app.$executeRawUnsafe(`UPDATE "BillingAccount" SET "label" = 'x' WHERE false`))).toBe(
      "42501",
    );
    expect(await pgCode(() => app.$executeRawUnsafe(`DELETE FROM "BillingAccount" WHERE false`))).toBe("42501");
  });
});
