/**
 * Phase 13-2B, Slice S2 — financial audit foundation: integration tests.
 *
 * ADR-0022 Amendment 5 BA-14; owner decisions F1–F7 (2026-11-27). Runs against
 * the real PostgreSQL 18 schema:
 *   - the writer and every "runtime" probe use the RUNTIME role (DATABASE_URL →
 *     telvyn_app in the isolated env), so SELECT + INSERT-only is exercised;
 *   - fixtures and owner-level guard probes use the table owner (fixturePrisma)
 *     — the guard triggers fire for the owner too.
 * The writer is constructed with a TEST-ONLY operation catalog: the production
 * catalog is empty in S2 (F1) and no production mutation exists, so atomicity
 * is demonstrated with a test-only transaction composition (a Tenant rename).
 * Users/tenants use a dedicated domain/slug and are never deleted: audit FKs
 * are ON DELETE RESTRICT.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixturePrisma } from "./fixture-db";

process.env.NODE_ENV = "test";

import { PrismaService } from "../src/infra/prisma.service";
import {
  FINANCIAL_AUDIT_OPERATIONS,
  FinancialAuditError,
  FinancialAuditWriter,
  type FinancialAuditActor,
  type FinancialAuditEventInput,
} from "../src/billing/financial-audit.writer";

const fix = fixturePrisma;
const prisma = new PrismaService(); // runtime role
const OP = "test_only.audit_probe";
const writer = new FinancialAuditWriter(new Set([OP]));
const productionWriter = new FinancialAuditWriter(); // empty catalog (F1)

const RUN = `s2-${Date.now().toString(36)}`;
let seq = 0;
const uniq = (p: string) => `${RUN}-${p}-${++seq}`;

async function pgCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e: unknown) {
    const err = e as { code?: string; meta?: { code?: string } };
    // Raw queries surface the PostgreSQL SQLSTATE in meta.code; model calls
    // surface Prisma's own code (e.g. P2003 for an FK violation).
    if (err.meta?.code) return err.meta.code;
    return err.code ?? "UNKNOWN";
  }
  return "NO_ERROR";
}

type TType = "PLATFORM" | "CUSTOMER" | "RESELLER";

async function tenant(type: TType = "CUSTOMER") {
  return fix.tenant.create({ data: { slug: uniq("t"), name: "s2-original", type } });
}

async function actorIn(tenantId: string, tenantType: TType): Promise<FinancialAuditActor & { sessionId: string }> {
  const user = await fix.user.create({ data: { email: `${uniq("u")}@s2-audit.test`, passwordHash: "x", status: "ACTIVE", mfaEnabled: true } });
  const m = await fix.membership.create({ data: { userId: user.id, tenantId, status: "ACTIVE" } });
  const s = await fix.session.create({ data: { userId: user.id, tenantId, expiresAt: new Date(Date.now() + 86_400_000) } });
  return {
    ctx: { userId: user.id, tenantId, tenantType, membershipId: m.id, permissions: new Set() },
    req: { ipAddress: "127.0.0.1", userAgent: "s2-e2e" },
    sessionId: s.id,
  };
}

async function billingAccount(tenantId: string) {
  return fix.billingAccount.create({
    data: {
      tenantId,
      accountNumber: uniq("acct"),
      label: uniq("label"),
      currency: "USD",
      mode: "PREPAID",
      provisioningKey: uniq("pk"),
      provisioningFingerprint: "fp",
    },
  });
}

async function stepUpGrant(a: FinancialAuditActor & { sessionId: string }) {
  const r = await fix.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "StepUpGrant" ("userId","sessionId","tenantId","purpose","expiresAt")
     VALUES ($1::uuid,$2::uuid,$3::uuid,'test_only.audit_probe', now() + interval '300 seconds') RETURNING "id"`,
    a.ctx.userId,
    a.sessionId,
    a.ctx.tenantId,
  );
  return r[0].id;
}

const event = (tenantId: string, over: Partial<FinancialAuditEventInput> = {}): FinancialAuditEventInput => ({
  operation: OP,
  tenantId,
  reasonCode: "TEST_PROBE",
  ...over,
});

const auditCount = (tenantId: string) => fix.financialAuditEvent.count({ where: { tenantId } });
const tenantName = async (id: string) => (await fix.tenant.findUniqueOrThrow({ where: { id } })).name;

/** Raw INSERT as a given client (bypasses the writer) — for database-guard probes. */
function rawInsert(
  client: { $executeRawUnsafe: (q: string, ...v: unknown[]) => Promise<number> },
  r: { actorUserId: string; actorTenantId: string; tenantId: string; extraCols?: string; extraVals?: string },
) {
  return client.$executeRawUnsafe(
    `INSERT INTO "FinancialAuditEvent" ("operation","decision","actorUserId","actorTenantId","tenantId","reasonCode"${r.extraCols ?? ""})
     VALUES ('${OP}','ALLOWED',$1::uuid,$2::uuid,$3::uuid,'TEST_PROBE'${r.extraVals ?? ""})`,
    r.actorUserId,
    r.actorTenantId,
    r.tenantId,
  );
}

let cust: { id: string };
let custActor: FinancialAuditActor & { sessionId: string };

beforeAll(async () => {
  await prisma.$connect();
  cust = await tenant("CUSTOMER");
  custActor = await actorIn(cust.id, "CUSTOMER");
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("positive audit writing (BA-14)", () => {
  it("writes one ALLOWED event in the caller's transaction with server-derived attribution", async () => {
    const acct = await billingAccount(cust.id);
    const grant = await stepUpGrant(custActor);
    const { id } = await prisma.$transaction((tx) =>
      writer.record(tx, custActor, event(cust.id, {
        billingAccountId: acct.id,
        permission: "test_only.permission",
        stepUpGrantId: grant,
        before: { status: "ACTIVE" },
        after: { status: "SUSPENDED" },
        details: { note: "probe" },
        idempotencyKey: "idem-1",
        correlationId: "corr-1",
      })),
    );
    const row = await fix.financialAuditEvent.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      operation: OP,
      decision: "ALLOWED",
      actorUserId: custActor.ctx.userId,
      actorTenantId: cust.id,
      tenantId: cust.id,
      billingAccountId: acct.id,
      stepUpGrantId: grant,
      reasonCode: "TEST_PROBE",
      before: { status: "ACTIVE" },
      after: { status: "SUSPENDED" },
      idempotencyKey: "idem-1",
      correlationId: "corr-1",
      ipAddress: "127.0.0.1",
      userAgent: "s2-e2e",
    });
  });

  it("a platform actor may audit a customer-owned object and stays distinguishable from the owner", async () => {
    const plat = await tenant("PLATFORM");
    const platActor = await actorIn(plat.id, "PLATFORM");
    const { id } = await prisma.$transaction((tx) => writer.record(tx, platActor, event(cust.id)));
    const row = await fix.financialAuditEvent.findUniqueOrThrow({ where: { id } });
    expect(row.actorTenantId).toBe(plat.id);
    expect(row.tenantId).toBe(cust.id);
  });

  it("duplicate idempotency references are NOT deduplicated by the audit (F7)", async () => {
    const t = await tenant();
    const a = await actorIn(t.id, "CUSTOMER");
    for (let i = 0; i < 2; i++) {
      await prisma.$transaction((tx) => writer.record(tx, a, event(t.id, { idempotencyKey: "same-key" })));
    }
    expect(await fix.financialAuditEvent.count({ where: { tenantId: t.id, idempotencyKey: "same-key" } })).toBe(2);
  });

  it("createdAt is stamped from the database clock (client value ignored)", async () => {
    const t = await tenant();
    const a = await actorIn(t.id, "CUSTOMER");
    await rawInsert(fix, { actorUserId: a.ctx.userId, actorTenantId: t.id, tenantId: t.id, extraCols: `,"createdAt"`, extraVals: `,'2000-01-01T00:00:00Z'` });
    const row = await fix.financialAuditEvent.findFirstOrThrow({ where: { tenantId: t.id } });
    expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
  });
});

describe("negative validation and attribution", () => {
  it("the production catalog refuses every operation and writes nothing (inert, F1)", async () => {
    expect(FINANCIAL_AUDIT_OPERATIONS.size).toBe(0);
    const before = await auditCount(cust.id);
    await expect(prisma.$transaction((tx) => productionWriter.record(tx, custActor, event(cust.id)))).rejects.toMatchObject({
      reason: "unknown_operation",
    });
    expect(await auditCount(cust.id)).toBe(before);
  });

  it("a non-platform actor cannot attribute to another tenant — writer and database (FA004)", async () => {
    const other = await tenant();
    await expect(prisma.$transaction((tx) => writer.record(tx, custActor, event(other.id)))).rejects.toMatchObject({
      reason: "attribution_mismatch",
    });
    expect(await pgCode(() => rawInsert(prisma, { actorUserId: custActor.ctx.userId, actorTenantId: cust.id, tenantId: other.id }))).toBe("FA004");
    expect(await auditCount(other.id)).toBe(0);
  });

  it("a cross-tenant BillingAccount reference is not representable (composite FK, 23503)", async () => {
    const other = await tenant();
    const foreignAcct = await billingAccount(other.id);
    expect(
      await pgCode(() => prisma.$transaction((tx) => writer.record(tx, custActor, event(cust.id, { billingAccountId: foreignAcct.id })))),
    ).toBe("P2003"); // Prisma's FK-violation code for the 23503 raised by the composite FK
    expect(
      await pgCode(() =>
        rawInsert(prisma, { actorUserId: custActor.ctx.userId, actorTenantId: cust.id, tenantId: cust.id, extraCols: `,"billingAccountId"`, extraVals: `,'${foreignAcct.id}'::uuid` }),
      ),
    ).toBe("23503");
  });

  it("a step-up grant of another actor cannot be cited (FA005)", async () => {
    const t = await tenant();
    const other = await actorIn(t.id, "CUSTOMER");
    const foreignGrant = await stepUpGrant(other);
    expect(
      await pgCode(() =>
        rawInsert(prisma, { actorUserId: custActor.ctx.userId, actorTenantId: cust.id, tenantId: cust.id, extraCols: `,"stepUpGrantId"`, extraVals: `,'${foreignGrant}'::uuid` }),
      ),
    ).toBe("FA005");
  });

  it("database CHECKs refuse malformed identifiers and oversized / non-object metadata (23514)", async () => {
    const base = { actorUserId: custActor.ctx.userId, actorTenantId: cust.id, tenantId: cust.id };
    const big = JSON.stringify({ blob: "x".repeat(4100) });
    const many = JSON.stringify(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i])));
    const probes: Array<[string, string]> = [
      [`,"permission"`, `,'Not Valid'`],
      [`,"correlationId"`, `,'${"c".repeat(129)}'`],
      [`,"details"`, `,'${big}'::jsonb`],
      [`,"before"`, `,'${many}'::jsonb`],
      [`,"after"`, `,'[1,2]'::jsonb`],
    ];
    for (const [c, v] of probes) expect(await pgCode(() => rawInsert(prisma, { ...base, extraCols: c, extraVals: v }))).toBe("23514");
    expect(
      await pgCode(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "FinancialAuditEvent" ("operation","decision","actorUserId","actorTenantId","tenantId","reasonCode")
           VALUES ('${OP}','ALLOWED',$1::uuid,$2::uuid,$2::uuid,'lower')`,
          custActor.ctx.userId,
          cust.id,
        ),
      ),
    ).toBe("23514");
    expect(
      await pgCode(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "FinancialAuditEvent" ("operation","decision","actorUserId","actorTenantId","tenantId","reasonCode")
           VALUES ('Bad Op','ALLOWED',$1::uuid,$2::uuid,$2::uuid,'TEST_PROBE')`,
          custActor.ctx.userId,
          cust.id,
        ),
      ),
    ).toBe("23514");
  });

  it("sensitive metadata is refused before any write", async () => {
    const before = await auditCount(cust.id);
    await expect(
      prisma.$transaction((tx) => writer.record(tx, custActor, event(cust.id, { details: { refreshToken: "never-stored" } }))),
    ).rejects.toMatchObject({ reason: "sensitive_metadata" });
    expect(await auditCount(cust.id)).toBe(before);
  });
});

describe("transaction atomicity — fail closed (BA-14)", () => {
  it("success: the test-only mutation and its audit event commit together", async () => {
    const t = await tenant();
    const a = await actorIn(t.id, "CUSTOMER");
    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: t.id }, data: { name: "s2-renamed" } });
      await writer.record(tx, a, event(t.id));
    });
    expect(await tenantName(t.id)).toBe("s2-renamed");
    expect(await auditCount(t.id)).toBe(1);
  });

  it("A: mutation succeeds provisionally, audit insert fails in the database → whole transaction rolls back", async () => {
    const t = await tenant();
    const a = await actorIn(t.id, "CUSTOMER");
    const missingGrant = "0190a1b2-c3d4-7e5f-8a9b-00000000dead";
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.tenant.update({ where: { id: t.id }, data: { name: "s2-must-not-persist" } });
        await writer.record(tx, a, event(t.id, { stepUpGrantId: missingGrant })); // FA005 from the guard
      }),
    ).rejects.toThrow();
    expect(await tenantName(t.id)).toBe("s2-original");
    expect(await auditCount(t.id)).toBe(0);
  });

  it("A': audit validation fails after the mutation → whole transaction rolls back", async () => {
    const t = await tenant();
    const a = await actorIn(t.id, "CUSTOMER");
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.tenant.update({ where: { id: t.id }, data: { name: "s2-must-not-persist" } });
        await writer.record(tx, a, event(t.id, { reasonCode: "bad" }));
      }),
    ).rejects.toBeInstanceOf(FinancialAuditError);
    expect(await tenantName(t.id)).toBe("s2-original");
    expect(await auditCount(t.id)).toBe(0);
  });

  it("B: audit insert succeeds provisionally, a later operation fails → the audit row rolls back too", async () => {
    const t = await tenant();
    const a = await actorIn(t.id, "CUSTOMER");
    let provisionalId = "";
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.tenant.update({ where: { id: t.id }, data: { name: "s2-must-not-persist" } });
        provisionalId = (await writer.record(tx, a, event(t.id))).id;
        // Visible inside the transaction…
        expect(await tx.financialAuditEvent.count({ where: { id: provisionalId } })).toBe(1);
        throw new Error("later step failed");
      }),
    ).rejects.toThrow("later step failed");
    expect(provisionalId).not.toBe("");
    expect(await fix.financialAuditEvent.count({ where: { id: provisionalId } })).toBe(0);
    expect(await tenantName(t.id)).toBe("s2-original");
  });

  it("no fallback: the base (runtime or scoped) client is refused and nothing is written independently", async () => {
    const t = await tenant();
    const a = await actorIn(t.id, "CUSTOMER");
    await expect(writer.record(prisma as never, a, event(t.id))).rejects.toMatchObject({ reason: "not_in_transaction" });
    await expect(writer.record(prisma.scoped as never, a, event(t.id))).rejects.toMatchObject({ reason: "not_in_transaction" });
    expect(await auditCount(t.id)).toBe(0);
  });
});

describe("database immutability (F6)", () => {
  async function seededRow() {
    const t = await tenant();
    const a = await actorIn(t.id, "CUSTOMER");
    const { id } = await prisma.$transaction((tx) => writer.record(tx, a, event(t.id)));
    return { id, t, a };
  }

  it("runtime role: UPDATE, DELETE and TRUNCATE are refused by privilege (42501)", async () => {
    const { id } = await seededRow();
    expect(await pgCode(() => prisma.$executeRawUnsafe(`UPDATE "FinancialAuditEvent" SET "reasonCode"='X_Y_Z' WHERE "id"=$1::uuid`, id))).toBe("42501");
    expect(await pgCode(() => prisma.$executeRawUnsafe(`DELETE FROM "FinancialAuditEvent" WHERE "id"=$1::uuid`, id))).toBe("42501");
    expect(await pgCode(() => prisma.$executeRawUnsafe(`TRUNCATE "FinancialAuditEvent"`))).toBe("42501");
    expect(await pgCode(() => prisma.$executeRawUnsafe(`ALTER TABLE "FinancialAuditEvent" DISABLE TRIGGER ALL`))).toBe("42501");
  });

  it("table owner: the guard triggers refuse UPDATE (FA001), DELETE (FA002) and TRUNCATE (FA003)", async () => {
    const { id } = await seededRow();
    expect(await pgCode(() => fix.$executeRawUnsafe(`UPDATE "FinancialAuditEvent" SET "reasonCode"='X_Y_Z' WHERE "id"=$1::uuid`, id))).toBe("FA001");
    expect(await pgCode(() => fix.$executeRawUnsafe(`DELETE FROM "FinancialAuditEvent" WHERE "id"=$1::uuid`, id))).toBe("FA002");
    expect(await pgCode(() => fix.$executeRawUnsafe(`TRUNCATE "FinancialAuditEvent"`))).toBe("FA003");
    expect(await fix.financialAuditEvent.count({ where: { id } })).toBe(1);
  });

  it("historical attribution is preserved: deleting the referenced user, tenant or account is refused (23001)", async () => {
    const t = await tenant();
    const a = await actorIn(t.id, "CUSTOMER");
    const acct = await billingAccount(t.id);
    await prisma.$transaction((tx) => writer.record(tx, a, event(t.id, { billingAccountId: acct.id })));
    expect(await pgCode(() => fix.$executeRawUnsafe(`DELETE FROM "BillingAccount" WHERE "id"=$1::uuid`, acct.id))).toBe("23001");
    await fix.membership.deleteMany({ where: { userId: a.ctx.userId } });
    await fix.session.deleteMany({ where: { userId: a.ctx.userId } });
    expect(await pgCode(() => fix.$executeRawUnsafe(`DELETE FROM "User" WHERE "id"=$1::uuid`, a.ctx.userId))).toBe("23001");
    expect(await pgCode(() => fix.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE "id"=$1::uuid`, t.id))).toBe("23001");
  });

  it("runtime holds SELECT + INSERT only — no UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER", async () => {
    const r = await prisma.$queryRawUnsafe<Array<Record<string, boolean>>>(
      `SELECT ${["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
        .map((p) => `has_table_privilege(current_user,'public."FinancialAuditEvent"','${p}') AS "${p}"`)
        .join(", ")}`,
    );
    expect(r[0]).toEqual({ SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false });
  });
});
