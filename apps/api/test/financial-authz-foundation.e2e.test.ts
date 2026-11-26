/**
 * Phase 13-2B, Slice S1 — financial authorization foundation: integration tests.
 *
 * ADR-0022 Amendment 5 BA-08 (wallet.credit retired) and BA-15 (server-side
 * step-up grant + TOTP replay guard); owner decisions G1 (300 s) and G2 (narrow
 * runtime grant), 2026-11-26. Runs against the real PostgreSQL 18 schema:
 *   - services (MfaService, StepUpService) use the RUNTIME role (DATABASE_URL →
 *     telvyn_app in the isolated env), so the narrow privilege matrix is exercised;
 *   - fixtures and DB-guard probes use the table owner (fixturePrisma).
 * Users use a dedicated e-mail domain (never @telvyn.test, which other suites
 * hard-delete) and are never deleted: StepUpGrant FKs are ON DELETE RESTRICT.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { fixturePrisma } from "./fixture-db";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");

import { PrismaService } from "../src/infra/prisma.service";
import { MfaService } from "../src/auth/mfa.service";
import { StepUpError, StepUpService, STEP_UP_GRANT_TTL_SECONDS, type StepUpBinding } from "../src/auth/step-up.service";
import { encryptSecret } from "../src/common/crypto.util";
import { loadEnv } from "../src/config/env";

const fix = fixturePrisma;
const prisma = new PrismaService(); // runtime role
const mfa = new MfaService(prisma);
const stepUp = new StepUpService(prisma, mfa);

const RUN = `s1-${Date.now().toString(36)}`;
let seq = 0;
const uniq = (p: string) => `${RUN}-${p}-${++seq}`;
const PURPOSE = "billing_account.provision";

/** A code for the time step `offset` steps from now (accepted within ±1). */
const codeAt = (secret: string, offset = 0) => authenticator.clone({ epoch: Date.now() + offset * 30_000 }).generate(secret);

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

async function stepUpReason(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof StepUpError) return e.reason;
    throw e;
  }
  return "NO_ERROR";
}

interface Actor {
  userId: string;
  tenantId: string;
  sessionId: string;
  membershipId: string;
  secret: string;
  binding: StepUpBinding;
}

/** User with MFA (unless mfa=false) + ACTIVE membership + live session bound to the tenant. */
async function actor(opts: { mfa?: boolean; tenantId?: string } = {}): Promise<Actor> {
  const secret = authenticator.generateSecret();
  const user = await fix.user.create({
    data: {
      email: `${uniq("u")}@s1-authz.test`,
      passwordHash: "x",
      status: "ACTIVE",
      mfaEnabled: opts.mfa !== false,
      mfaSecretEnc: encryptSecret(secret, loadEnv().APP_ENCRYPTION_KEY),
    },
  });
  const tenantId =
    opts.tenantId ?? (await fix.tenant.create({ data: { slug: uniq("t"), name: "t", type: "PLATFORM" } })).id;
  const membership = await fix.membership.create({ data: { userId: user.id, tenantId, status: "ACTIVE" } });
  const session = await fix.session.create({
    data: { userId: user.id, tenantId, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  return {
    userId: user.id,
    tenantId,
    sessionId: session.id,
    membershipId: membership.id,
    secret,
    binding: { userId: user.id, sessionId: session.id, tenantId, purpose: PURPOSE },
  };
}

async function grantRow(id: string) {
  const r = await fix.$queryRawUnsafe<Array<{ consumedAt: Date | null; createdAt: Date; expiresAt: Date }>>(
    `SELECT "consumedAt","createdAt","expiresAt" FROM "StepUpGrant" WHERE "id" = $1::uuid`,
    id,
  );
  return r[0];
}

/** Insert a grant directly as the owner (bypasses TOTP) — for guard/expiry probes. */
function rawGrant(a: Actor, lifetime = "300 seconds", extra: { consumedAt?: string } = {}) {
  return fix
    .$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "StepUpGrant" ("userId","sessionId","tenantId","purpose","expiresAt","consumedAt")
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4, now() + $5::interval, ${extra.consumedAt ?? "NULL"}) RETURNING "id"`,
      a.userId,
      a.sessionId,
      a.tenantId,
      PURPOSE,
      lifetime,
    )
    .then((r) => r[0].id);
}

beforeAll(async () => {
  await prisma.$connect();
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("TOTP replay guard (BA-15)", () => {
  it("a TOTP code is accepted at most once", async () => {
    const a = await actor();
    const code = codeAt(a.secret);
    expect(await mfa.verifyCode(a.userId, code)).toBe(true);
    expect(await mfa.verifyCode(a.userId, code)).toBe(false);
    expect(await mfa.verifyTotpOnly(a.userId, code)).toBe(false);
  });
  it("concurrent presentations of one code: exactly one succeeds", async () => {
    const a = await actor();
    const code = codeAt(a.secret);
    const res = await Promise.all([mfa.verifyCode(a.userId, code), mfa.verifyCode(a.userId, code), mfa.verifyCode(a.userId, code)]);
    expect(res.filter(Boolean)).toHaveLength(1);
  });
  it("after a later step is accepted, an earlier step's code is refused", async () => {
    const a = await actor();
    expect(await mfa.verifyCode(a.userId, codeAt(a.secret, 1))).toBe(true);
    expect(await mfa.verifyCode(a.userId, codeAt(a.secret, 0))).toBe(false);
  });
  it("step-up accepts TOTP only — a recovery code is never a step-up proof", async () => {
    const a = await actor();
    expect(await mfa.verifyTotpOnly(a.userId, "abcdef1234")).toBe(false);
    expect(await mfa.verifyTotpOnly(a.userId, "000000")).toBe(false);
  });
});

describe("StepUpService.issue (BA-15, G1)", () => {
  it("issues a grant bound to user/session/tenant/purpose, valid for exactly 300 s (DB clock)", async () => {
    const a = await actor();
    const g = await stepUp.issue(a.binding, codeAt(a.secret));
    const row = await grantRow(g.grantId);
    expect(STEP_UP_GRANT_TTL_SECONDS).toBe(300);
    expect(row.consumedAt).toBeNull();
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(300_000);
  });
  it("rejects an invalid or replayed TOTP code", async () => {
    const a = await actor();
    expect(await stepUpReason(() => stepUp.issue(a.binding, "000000"))).toBe("invalid_code");
    const code = codeAt(a.secret);
    await stepUp.issue(a.binding, code);
    expect(await stepUpReason(() => stepUp.issue(a.binding, code))).toBe("invalid_code");
  });
  it("rejects a malformed purpose before any verification", async () => {
    const a = await actor();
    expect(await stepUpReason(() => stepUp.issue({ ...a.binding, purpose: "Bad Purpose!" }, codeAt(a.secret)))).toBe(
      "invalid_purpose",
    );
  });
  it("is unavailable without MFA, on a revoked/foreign session, for a foreign tenant, or for a suspended membership/disabled user", async () => {
    const noMfa = await actor({ mfa: false });
    expect(await stepUpReason(() => stepUp.issue(noMfa.binding, codeAt(noMfa.secret)))).toBe("not_eligible");

    const a = await actor();
    const b = await actor();
    // another user's session
    expect(await stepUpReason(() => stepUp.issue({ ...a.binding, sessionId: b.sessionId }, codeAt(a.secret)))).toBe("not_eligible");
    // a tenant the session is not bound to (even one the user is a member of)
    const other = await fix.tenant.create({ data: { slug: uniq("t2"), name: "t2", type: "CUSTOMER" } });
    await fix.membership.create({ data: { userId: a.userId, tenantId: other.id, status: "ACTIVE" } });
    expect(await stepUpReason(() => stepUp.issue({ ...a.binding, tenantId: other.id }, codeAt(a.secret)))).toBe("not_eligible");

    const revoked = await actor();
    await fix.session.update({ where: { id: revoked.sessionId }, data: { revokedAt: new Date() } });
    expect(await stepUpReason(() => stepUp.issue(revoked.binding, codeAt(revoked.secret)))).toBe("not_eligible");

    const suspended = await actor();
    await fix.membership.update({ where: { id: suspended.membershipId }, data: { status: "SUSPENDED" } });
    expect(await stepUpReason(() => stepUp.issue(suspended.binding, codeAt(suspended.secret)))).toBe("not_eligible");

    const disabled = await actor();
    await fix.user.update({ where: { id: disabled.userId }, data: { status: "DISABLED" } });
    expect(await stepUpReason(() => stepUp.issue(disabled.binding, codeAt(disabled.secret)))).toBe("not_eligible");
  });
});

describe("StepUpService.consume — single-use, fully bound (BA-15)", () => {
  it("consumes once; a replay is refused", async () => {
    const a = await actor();
    const { grantId } = await stepUp.issue(a.binding, codeAt(a.secret));
    await stepUp.consume(grantId, a.binding);
    expect((await grantRow(grantId)).consumedAt).not.toBeNull();
    expect(await stepUpReason(() => stepUp.consume(grantId, a.binding))).toBe("step_up_required");
  });
  it("refuses a wrong actor, session, tenant or purpose — and leaves the grant unconsumed", async () => {
    const a = await actor();
    const b = await actor({ tenantId: a.tenantId });
    const { grantId } = await stepUp.issue(a.binding, codeAt(a.secret));
    for (const wrong of [
      { ...a.binding, userId: b.userId },
      { ...a.binding, sessionId: b.sessionId },
      { ...a.binding, tenantId: (await actor()).tenantId },
      { ...a.binding, purpose: "billing_account.close" },
    ]) {
      expect(await stepUpReason(() => stepUp.consume(grantId, wrong))).toBe("step_up_required");
    }
    expect((await grantRow(grantId)).consumedAt).toBeNull();
    await stepUp.consume(grantId, a.binding); // the rightful holder still can
  });
  it("refuses an unknown grant id", async () => {
    const a = await actor();
    expect(await stepUpReason(() => stepUp.consume("01900000-0000-7000-8000-000000000000", a.binding))).toBe("step_up_required");
  });
  it("refuses an expired grant", async () => {
    const a = await actor();
    const id = await rawGrant(a, "1 second");
    await new Promise((r) => setTimeout(r, 1_200));
    expect(await stepUpReason(() => stepUp.consume(id, a.binding))).toBe("step_up_required");
  });
  it("refuses after the session is revoked, MFA is disabled, or the user is disabled", async () => {
    const r = await actor();
    const g1 = await stepUp.issue(r.binding, codeAt(r.secret));
    await fix.session.update({ where: { id: r.sessionId }, data: { revokedAt: new Date() } });
    expect(await stepUpReason(() => stepUp.consume(g1.grantId, r.binding))).toBe("step_up_required");

    const m = await actor();
    const g2 = await stepUp.issue(m.binding, codeAt(m.secret));
    await fix.user.update({ where: { id: m.userId }, data: { mfaEnabled: false } });
    expect(await stepUpReason(() => stepUp.consume(g2.grantId, m.binding))).toBe("step_up_required");

    const d = await actor();
    const g3 = await stepUp.issue(d.binding, codeAt(d.secret));
    await fix.user.update({ where: { id: d.userId }, data: { status: "DISABLED" } });
    expect(await stepUpReason(() => stepUp.consume(g3.grantId, d.binding))).toBe("step_up_required");
  });
  it("two concurrent consumers of one grant: exactly one succeeds", async () => {
    const a = await actor();
    const { grantId } = await stepUp.issue(a.binding, codeAt(a.secret));
    const res = await Promise.allSettled([stepUp.consume(grantId, a.binding), stepUp.consume(grantId, a.binding)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("consumption inside a rolled-back caller transaction does not spend the grant", async () => {
    const a = await actor();
    const { grantId } = await stepUp.issue(a.binding, codeAt(a.secret));
    await expect(
      prisma.$transaction(async (tx) => {
        await stepUp.consume(grantId, a.binding, tx);
        throw new Error("protected operation failed");
      }),
    ).rejects.toThrow("protected operation failed");
    expect((await grantRow(grantId)).consumedAt).toBeNull();
    await stepUp.consume(grantId, a.binding);
  });
});

describe("StepUpGrant database guards (raw SQL, owner role — triggers fire for owners)", () => {
  it("lifetime is capped at 300 s and must be positive (23514)", async () => {
    const a = await actor();
    expect(await pgCode(() => rawGrant(a, "301 seconds"))).toBe("23514");
    expect(await pgCode(() => rawGrant(a, "0 seconds"))).toBe("23514");
  });
  it("purpose must be a server-defined identifier (23514)", async () => {
    const a = await actor();
    expect(
      await pgCode(() =>
        fix.$executeRawUnsafe(
          `INSERT INTO "StepUpGrant" ("userId","sessionId","tenantId","purpose","expiresAt") VALUES ($1::uuid,$2::uuid,$3::uuid,'X y',now()+interval '60 seconds')`,
          a.userId,
          a.sessionId,
          a.tenantId,
        ),
      ),
    ).toBe("23514");
  });
  it("cannot be inserted already consumed (SG003); createdAt is DB-stamped", async () => {
    const a = await actor();
    expect(await pgCode(() => rawGrant(a, "60 seconds", { consumedAt: "now()" }))).toBe("SG003");
    const id = (
      await fix.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "StepUpGrant" ("userId","sessionId","tenantId","purpose","expiresAt","createdAt")
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4, now()+interval '60 seconds', '2000-01-01T00:00:00Z') RETURNING "id"`,
        a.userId,
        a.sessionId,
        a.tenantId,
        PURPOSE,
      )
    )[0].id;
    expect((await grantRow(id)).createdAt.getUTCFullYear()).toBeGreaterThan(2000);
  });
  it("binding is immutable (SG001) and single-use is enforced in the database (SG002)", async () => {
    const a = await actor();
    const id = await rawGrant(a);
    for (const set of [`"purpose" = 'billing_account.close'`, `"expiresAt" = "expiresAt" + interval '1 hour'`, `"userId" = uuidv7()`]) {
      expect(await pgCode(() => fix.$executeRawUnsafe(`UPDATE "StepUpGrant" SET ${set} WHERE "id" = $1::uuid`, id))).toBe("SG001");
    }
    await fix.$executeRawUnsafe(`UPDATE "StepUpGrant" SET "consumedAt" = now() WHERE "id" = $1::uuid`, id);
    expect(await pgCode(() => fix.$executeRawUnsafe(`UPDATE "StepUpGrant" SET "consumedAt" = NULL WHERE "id" = $1::uuid`, id))).toBe("SG002");
    expect(await pgCode(() => fix.$executeRawUnsafe(`UPDATE "StepUpGrant" SET "consumedAt" = now() WHERE "id" = $1::uuid`, id))).toBe("SG002");
  });
  it("runtime role cannot delete grants or change binding columns (42501, G2)", async () => {
    const a = await actor();
    const id = await rawGrant(a);
    expect(await pgCode(() => prisma.$executeRawUnsafe(`DELETE FROM "StepUpGrant" WHERE "id" = $1::uuid`, id))).toBe("42501");
    expect(
      await pgCode(() => prisma.$executeRawUnsafe(`UPDATE "StepUpGrant" SET "expiresAt" = now() WHERE "id" = $1::uuid`, id)),
    ).toBe("42501");
  });
  it("grants are evidence: deleting their user, session or tenant is refused (23001)", async () => {
    const a = await actor();
    await rawGrant(a);
    expect(await pgCode(() => fix.$executeRawUnsafe(`DELETE FROM "Session" WHERE "id" = $1::uuid`, a.sessionId))).toBe("23001");
  });
});

describe("wallet.credit retirement (BA-08)", () => {
  it("the permission row and every grant of it are gone", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM "Permission" WHERE "key" = 'wallet.credit'`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});
