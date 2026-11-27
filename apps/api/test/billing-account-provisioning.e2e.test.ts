import "./e2e-guard"; // INC-DB-001B: two-stage target guard — must stay the FIRST import
import { fixturePrisma } from "./fixture-db";
/**
 * Phase 13-2B, Slice S5 — platform BillingAccount provisioning: integration tests.
 *
 * ADR-0022 Amendment 5 BA-03/BA-08/BA-14/BA-15; owner decisions O1–O7
 * (2026-11-28). Real PostgreSQL 18 + Redis through the HTTP API, plus direct
 * probes with the RESTRICTED runtime role (telvyn_app) and the table owner:
 *   - authorization: platform tenant + explicit, MFA-effective
 *     `billing.account.provision` (never via `*`) + a fresh single-use step-up
 *     grant bound to user/session/tenant/purpose — re-checked in the database;
 *   - atomicity: BillingAccount + customer_funds LedgerAccount + ALLOWED audit in
 *     one transaction (deferred BP010 completeness), full rollback on failure,
 *     DENIED attempts recorded in their own transaction;
 *   - idempotency: same key + same request replays with a FRESH grant (200), a
 *     different request is refused (409), no duplicates under concurrency;
 *   - no money movement: no ledger transaction, no opening balance.
 * Users use a dedicated e-mail domain and nothing is deleted: audit, ledger and
 * billing FKs are ON DELETE RESTRICT (immutable evidence).
 */
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";
import { PrismaClient } from "@prisma/client";
import type { NestExpressApplication } from "@nestjs/platform-express";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");

import { createApp } from "../src/main";
import { TokenService } from "../src/auth/token.service";
import { encryptSecret } from "../src/common/crypto.util";
import { loadEnv } from "../src/config/env";
import { FinancialAuditWriter } from "../src/billing/financial-audit.writer";
import {
  ACCOUNT_NUMBER_PATTERN,
  generateAccountNumberSuffix,
  provisioningFingerprint,
} from "../src/billing/billing-account-provisioning.contract";

const fix = fixturePrisma;
const runtime = new PrismaClient(); // DATABASE_URL → telvyn_app (restricted runtime role)
let app: NestExpressApplication;
let http: ReturnType<NestExpressApplication["getHttpServer"]>;
let tokens: TokenService;

const RUN = `s5-${Date.now().toString(36)}`;
let seq = 0;
const uniq = (p: string) => `${RUN}-${p}-${++seq}`;
const key = () => `${RUN}-idem-${++seq}-${Math.random().toString(36).slice(2, 10)}`;
const PURPOSE = "billing_account.provision";
const PERM = "billing.account.provision";
const URL = "/v1/platform/billing-accounts";
const TX = { timeout: 20_000, maxWait: 10_000 };
const YEAR = new Date().getUTCFullYear();

type TType = "PLATFORM" | "CUSTOMER" | "RESELLER";

async function pgCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e: unknown) {
    const err = e as { code?: string; meta?: { code?: string }; message?: string };
    if (err.meta?.code) return err.meta.code;
    const m = /\b(BP0\d\d|42501|23\d{3})\b/.exec(err.message ?? "");
    return m ? m[1] : `NO_META_CODE(${err.code ?? "?"})`;
  }
  return "NO_ERROR";
}

async function tenant(type: TType = "CUSTOMER", status: "ACTIVE" | "SUSPENDED" | "CLOSED" = "ACTIVE") {
  return fix.tenant.create({ data: { slug: uniq("t"), name: "s5", type, status } });
}

interface Actor {
  userId: string;
  tenantId: string;
  sessionId: string;
  secret: string;
  token: string;
}

/** A member with an ACTIVE membership + live session; `perm` adds a custom role holding ONLY billing.account.provision. */
async function actor(o: { tenantId?: string; type?: TType; mfa?: boolean; perm?: boolean; systemRoles?: string[] } = {}): Promise<Actor> {
  const secret = authenticator.generateSecret();
  const user = await fix.user.create({
    data: {
      email: `${uniq("u")}@s5-provision.test`,
      passwordHash: "x",
      status: "ACTIVE",
      mfaEnabled: o.mfa !== false,
      mfaSecretEnc: encryptSecret(secret, loadEnv().APP_ENCRYPTION_KEY),
    },
  });
  const tenantId = o.tenantId ?? (await tenant(o.type ?? "PLATFORM")).id;
  const m = await fix.membership.create({ data: { userId: user.id, tenantId, status: "ACTIVE" } });
  if (o.perm !== false) {
    // Explicit assignment by fixture: S5 has no runtime delegation path for this key (O4).
    const p = await fix.permission.findUniqueOrThrow({ where: { key: PERM } });
    const role = await fix.role.create({
      data: { tenantId, key: `s5_prov_${++seq}`, name: `S5 provisioner ${seq}`, isSystem: false, permissions: { create: [{ permissionId: p.id }] } },
    });
    await fix.membershipRole.create({ data: { membershipId: m.id, roleId: role.id } });
  }
  for (const k of o.systemRoles ?? []) {
    const r = await fix.role.findFirstOrThrow({ where: { tenantId: null, key: k } });
    await fix.membershipRole.create({ data: { membershipId: m.id, roleId: r.id } });
  }
  const session = await fix.session.create({ data: { userId: user.id, tenantId, expiresAt: new Date(Date.now() + 86_400_000) } });
  const token = tokens.signAccess(user.id, session.id, tenantId).accessToken;
  return { userId: user.id, tenantId, sessionId: session.id, secret, token };
}

/** A step-up grant inserted by the owner (bypasses TOTP) — the HTTP issuance path is tested separately. */
async function grant(a: Actor, o: { purpose?: string; lifetime?: string; sessionId?: string; tenantId?: string } = {}): Promise<string> {
  const r = await fix.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "StepUpGrant" ("userId","sessionId","tenantId","purpose","expiresAt")
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4, now() + $5::interval) RETURNING "id"`,
    a.userId,
    o.sessionId ?? a.sessionId,
    o.tenantId ?? a.tenantId,
    o.purpose ?? PURPOSE,
    o.lifetime ?? "300 seconds",
  );
  return r[0].id;
}

const consumedAt = async (id: string) =>
  (await fix.$queryRawUnsafe<Array<{ c: Date | null }>>(`SELECT "consumedAt" AS c FROM "StepUpGrant" WHERE "id"=$1::uuid`, id))[0].c;

function provision(a: Actor, body: Record<string, unknown>, idem: string | null, headers: Record<string, string> = {}) {
  const r = request(http).post(URL).set("Authorization", `Bearer ${a.token}`);
  if (idem !== null) r.set("Idempotency-Key", idem);
  for (const [h, v] of Object.entries(headers)) r.set(h, v);
  return r.send(body);
}

const body = (targetTenantId: string, stepUpGrantId: string, over: Record<string, unknown> = {}) => ({
  targetTenantId,
  currency: "USD",
  label: "Primary",
  stepUpGrantId,
  ...over,
});

const accountsFor = (tenantId: string) => fix.billingAccount.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
const audits = (actorUserId: string, decision?: "ALLOWED" | "DENIED") =>
  fix.financialAuditEvent.findMany({ where: { actorUserId, ...(decision ? { decision } : {}) }, orderBy: { createdAt: "asc" } });

/** Direct call of the database function as a given client (for restricted-role probes). */
function callProvision(
  db: Pick<PrismaClient, "$queryRawUnsafe">,
  a: { userId: string; tenantId: string },
  grantId: string,
  target: string,
  o: { label?: string; suffix?: string; key?: string } = {},
) {
  const label = o.label ?? uniq("direct");
  const fp = provisioningFingerprint({ actorUserId: a.userId, actorTenantId: a.tenantId, targetTenantId: target, currency: "USD", label, isDefault: false });
  return db.$queryRawUnsafe<Array<{ billing_account_id: string; replayed: boolean }>>(
    `SELECT * FROM billing.billing_account_provision($1::uuid,$2::uuid,$3::uuid,$4::uuid,'USD'::"Currency",$5,false,$6,$7,$8)`,
    a.userId,
    a.tenantId,
    grantId,
    target,
    label,
    o.suffix ?? generateAccountNumberSuffix(),
    o.key ?? key(),
    fp,
  );
}

async function platformContext(db: Pick<PrismaClient, "$queryRawUnsafe">, userId: string) {
  await db.$queryRawUnsafe(`SELECT set_config('app.tenant_id','',true), set_config('app.is_platform','on',true), set_config('app.actor_id',$1,true)`, userId);
}

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  tokens = app.get(TokenService);
  await runtime.$connect();
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await runtime.$disconnect();
  await app.close();
});

describe("happy path — atomic account + ledger account + ALLOWED audit (BA-03/BA-10/BA-14)", () => {
  it("creates one zero-balance PREPAID account with its customer_funds ledger account and one ALLOWED audit event", async () => {
    const a = await actor();
    const t = await tenant("CUSTOMER");
    const g = await grant(a);
    const idem = key();
    const res = await provision(a, body(t.id, g, { label: "  Primary  " }), idem, { "x-correlation-id": "corr-s5-1" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tenantId: t.id, label: "Primary", currency: "USD", mode: "PREPAID", status: "ACTIVE", isDefault: false, replayed: false });
    expect(res.body.accountNumber).toMatch(ACCOUNT_NUMBER_PATTERN);
    expect(res.body.accountNumber.startsWith(`BA-${YEAR}-`)).toBe(true);

    const [ba] = await accountsFor(t.id);
    expect(ba).toMatchObject({ id: res.body.id, provisioningKey: idem, provisionedByUserId: a.userId, mode: "PREPAID", status: "ACTIVE" });
    expect(ba.provisioningFingerprint).toMatch(/^v1:[0-9a-f]{64}$/);

    const la = await fix.ledgerAccount.findMany({ where: { billingAccountId: ba.id } });
    expect(la).toHaveLength(1);
    expect(la[0]).toMatchObject({ id: res.body.ledgerAccountId, tenantId: t.id, currency: "USD", code: `customer_funds:${ba.accountNumber}`, type: "LIABILITY", normalBalance: "CREDIT" });
    // No money movement: no ledger leg touches the new account (no opening balance).
    expect(await fix.ledgerLeg.count({ where: { accountId: la[0].id } })).toBe(0);

    const allowed = await audits(a.userId, "ALLOWED");
    expect(allowed).toHaveLength(1);
    expect(allowed[0]).toMatchObject({
      operation: PURPOSE,
      actorTenantId: a.tenantId,
      tenantId: t.id,
      billingAccountId: ba.id,
      permission: PERM,
      stepUpGrantId: g,
      reasonCode: "ACCOUNT_PROVISIONED",
      idempotencyKey: idem,
      correlationId: "corr-s5-1",
      ipAddress: null,
      userAgent: null,
      details: { fingerprintVersion: "v1" },
    });
    expect(allowed[0].after).toEqual({
      accountNumber: ba.accountNumber,
      currency: "USD",
      mode: "PREPAID",
      status: "ACTIVE",
      isDefault: false,
      label: "Primary",
      ledgerAccountId: la[0].id,
      ledgerTaxonomy: "customer_funds",
    });
    expect(await consumedAt(g)).not.toBeNull();
    // Security telemetry (O6) carries the request data instead.
    expect(await fix.auditLog.count({ where: { actorId: a.userId, action: "billing_account.provisioned", resourceId: ba.id } })).toBe(1);
  });

  it("a RESELLER tenant may own an account; isDefault is honoured", async () => {
    const a = await actor();
    const t = await tenant("RESELLER");
    const res = await provision(a, body(t.id, await grant(a), { isDefault: true, currency: "EUR" }), key());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ isDefault: true, currency: "EUR" });
  });
});

describe("idempotency (O5)", () => {
  it("a retry with the same key and request + a FRESH grant replays the original (200) — no duplicate account, ledger account or ALLOWED audit", async () => {
    const a = await actor();
    const t = await tenant();
    const idem = key();
    const first = await provision(a, body(t.id, await grant(a)), idem);
    expect(first.status).toBe(201);
    const g2 = await grant(a);
    const again = await provision(a, body(t.id, g2), idem);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.body.id, accountNumber: first.body.accountNumber, ledgerAccountId: first.body.ledgerAccountId, replayed: true });
    expect(await accountsFor(t.id)).toHaveLength(1);
    expect(await fix.ledgerAccount.count({ where: { billingAccountId: first.body.id } })).toBe(1);
    expect(await audits(a.userId, "ALLOWED")).toHaveLength(1);
    expect(await consumedAt(g2)).not.toBeNull(); // the replay still required (and consumed) a fresh grant
  });

  it("a replay never bypasses authorization: reusing the consumed grant is refused (403) and recorded", async () => {
    const a = await actor();
    const t = await tenant();
    const idem = key();
    const g = await grant(a);
    expect((await provision(a, body(t.id, g), idem)).status).toBe(201);
    const res = await provision(a, body(t.id, g), idem);
    expect(res.status).toBe(403);
    const denied = await audits(a.userId, "DENIED");
    expect(denied.map((d) => d.reasonCode)).toEqual(["STEP_UP_REQUIRED"]);
  });

  it("a replay after the permission was revoked is refused (403 PERMISSION_DENIED)", async () => {
    const a = await actor();
    const t = await tenant();
    const idem = key();
    expect((await provision(a, body(t.id, await grant(a)), idem)).status).toBe(201);
    await fix.membershipRole.deleteMany({ where: { membership: { userId: a.userId } } });
    const res = await provision(a, body(t.id, await grant(a)), idem);
    expect(res.status).toBe(403);
    expect((await audits(a.userId, "DENIED")).map((d) => d.reasonCode)).toEqual(["PERMISSION_DENIED"]);
  });

  it("the same key with different parameters is refused (409); the grant consumption rolls back", async () => {
    const a = await actor();
    const t = await tenant();
    const idem = key();
    expect((await provision(a, body(t.id, await grant(a)), idem)).status).toBe(201);
    const g2 = await grant(a);
    const res = await provision(a, body(t.id, g2, { label: "Different" }), idem);
    expect(res.status).toBe(409);
    expect(await consumedAt(g2)).toBeNull();
    expect(await accountsFor(t.id)).toHaveLength(1);
    expect((await audits(a.userId, "DENIED")).map((d) => d.reasonCode)).toEqual(["IDEMPOTENCY_CONFLICT"]);
  });

  it("the key is scoped to the actor: another platform actor reusing it for the same target is refused (409)", async () => {
    const a = await actor();
    const b = await actor({ tenantId: a.tenantId });
    const t = await tenant();
    const idem = key();
    expect((await provision(a, body(t.id, await grant(a)), idem)).status).toBe(201);
    expect((await provision(b, body(t.id, await grant(b)), idem)).status).toBe(409);
    expect(await accountsFor(t.id)).toHaveLength(1);
  });

  it("a missing or malformed Idempotency-Key is refused (400) and recorded", async () => {
    const a = await actor();
    const t = await tenant();
    for (const k of [null, "short", "x".repeat(129), "has space in it!!"]) {
      expect((await provision(a, body(t.id, await grant(a)), k)).status).toBe(400);
    }
    expect(await accountsFor(t.id)).toHaveLength(0);
    expect((await audits(a.userId, "DENIED")).every((d) => d.reasonCode === "INVALID_REQUEST")).toBe(true);
    expect(await audits(a.userId, "DENIED")).toHaveLength(4);
  });
});

describe("authorization (O1/O2/O4) — every refusal is a DENIED audit event", () => {
  it("a non-platform actor is refused even when holding the permission (403 PLATFORM_REQUIRED)", async () => {
    const c = await tenant("CUSTOMER");
    const a = await actor({ tenantId: c.id });
    const res = await provision(a, body(c.id, await grant(a)), key());
    expect(res.status).toBe(403);
    expect(await accountsFor(c.id)).toHaveLength(0);
    const [d] = await audits(a.userId, "DENIED");
    expect(d).toMatchObject({ reasonCode: "PLATFORM_REQUIRED", actorTenantId: c.id, tenantId: c.id, billingAccountId: null, stepUpGrantId: null });
    expect(d.details).toEqual({ targetTenantId: c.id, currency: "USD" });
  });

  it("the platform owner role (`*`) does NOT confer billing.account.provision (403) — no wildcard inheritance", async () => {
    const a = await actor({ perm: false, systemRoles: ["owner"] });
    const t = await tenant();
    expect((await provision(a, body(t.id, await grant(a)), key())).status).toBe(403);
    expect((await audits(a.userId, "DENIED")).map((d) => d.reasonCode)).toEqual(["PERMISSION_DENIED"]);
  });

  it("a platform member without the permission is refused (403)", async () => {
    const a = await actor({ perm: false });
    const t = await tenant();
    expect((await provision(a, body(t.id, await grant(a)), key())).status).toBe(403);
    expect(await accountsFor(t.id)).toHaveLength(0);
  });

  it("the permission is ineffective without MFA (403)", async () => {
    const a = await actor({ mfa: false });
    const t = await tenant();
    expect((await provision(a, body(t.id, await grant(a)), key())).status).toBe(403);
    expect((await audits(a.userId, "DENIED")).map((d) => d.reasonCode)).toEqual(["PERMISSION_DENIED"]);
  });

  // Expiry is enforced by StepUpService.consume and covered in financial-authz-foundation.e2e (a sub-lifetime
  // grant cannot be fabricated here: StepUpGrant_lifetime_chk requires expiresAt > createdAt).
  it("grants bound to another purpose, session or tenant and unknown grants are refused (403)", async () => {
    const a = await actor();
    const t = await tenant();
    const other = await fix.session.create({ data: { userId: a.userId, tenantId: a.tenantId, expiresAt: new Date(Date.now() + 86_400_000) } });
    const otherPlatform = await tenant("PLATFORM");
    await fix.membership.create({ data: { userId: a.userId, tenantId: otherPlatform.id, status: "ACTIVE" } });
    const bad = [
      await grant(a, { purpose: "billing_account.other_op" }),
      await grant(a, { sessionId: other.id }),
      await grant(a, { tenantId: otherPlatform.id }),
      "0190a1b2-c3d4-7e5f-8a9b-00000000beef",
    ];
    for (const g of bad) expect((await provision(a, body(t.id, g), key())).status).toBe(403);
    expect(await accountsFor(t.id)).toHaveLength(0);
    expect((await audits(a.userId, "DENIED")).every((d) => d.reasonCode === "STEP_UP_REQUIRED")).toBe(true);
  });

  it("a revoked session cannot provision (401)", async () => {
    const a = await actor();
    const t = await tenant();
    const g = await grant(a);
    await fix.session.update({ where: { id: a.sessionId }, data: { revokedAt: new Date() } });
    expect((await provision(a, body(t.id, g), key())).status).toBe(401);
    expect(await consumedAt(g)).toBeNull();
  });

  it("unauthenticated requests are refused (401) and nothing is written", async () => {
    const t = await tenant();
    const res = await request(http).post(URL).set("Idempotency-Key", key()).send(body(t.id, "0190a1b2-c3d4-7e5f-8a9b-00000000beef"));
    expect(res.status).toBe(401);
    expect(await accountsFor(t.id)).toHaveLength(0);
  });
});

describe("request validation and target eligibility", () => {
  it("POSTPAID, client-chosen numbers, opening balances and unknown fields are refused (400) without consuming the grant", async () => {
    const a = await actor();
    const t = await tenant();
    const g = await grant(a);
    for (const extra of [{ mode: "POSTPAID" }, { accountNumber: `BA-${YEAR}-ABCDEFGH2345` }, { openingBalance: 100 }, { tenantId: t.id }]) {
      expect((await provision(a, body(t.id, g, extra), key())).status).toBe(400);
    }
    expect(await consumedAt(g)).toBeNull();
    expect(await accountsFor(t.id)).toHaveLength(0);
  });

  it("platform, suspended, closed and unknown targets are ineligible (422); the grant consumption rolls back", async () => {
    const a = await actor();
    const targets = [
      (await tenant("PLATFORM")).id,
      (await tenant("CUSTOMER", "SUSPENDED")).id,
      (await tenant("CUSTOMER", "CLOSED")).id,
      "0190a1b2-c3d4-7e5f-8a9b-00000000f00d",
    ];
    for (const id of targets) {
      const g = await grant(a);
      expect((await provision(a, body(id, g), key())).status).toBe(422);
      expect(await consumedAt(g)).toBeNull();
    }
    const denied = await audits(a.userId, "DENIED");
    expect(denied.map((d) => d.reasonCode)).toEqual(Array(4).fill("TARGET_TENANT_INELIGIBLE"));
    expect(denied.every((d) => d.tenantId === a.tenantId)).toBe(true); // attributed to the actor's tenant
  });

  it("a second open account with the same label (any case) or a second default per currency is refused (409)", async () => {
    const a = await actor();
    const t = await tenant();
    expect((await provision(a, body(t.id, await grant(a), { label: "Ops", isDefault: true }), key())).status).toBe(201);
    expect((await provision(a, body(t.id, await grant(a), { label: " ops " }), key())).status).toBe(409);
    expect((await provision(a, body(t.id, await grant(a), { label: "Other", isDefault: true }), key())).status).toBe(409);
    expect((await provision(a, body(t.id, await grant(a), { label: "Other", isDefault: true, currency: "GBP" }), key())).status).toBe(201);
    expect(await accountsFor(t.id)).toHaveLength(2);
    expect((await audits(a.userId, "DENIED")).map((d) => d.reasonCode)).toEqual(["ACCOUNT_CONFLICT", "ACCOUNT_CONFLICT"]);
  });
});

describe("atomicity — complete rollback (BA-14)", () => {
  it("an audit-write failure rolls back the account, the ledger account and the grant consumption (500)", async () => {
    const a = await actor();
    const t = await tenant();
    const g = await grant(a);
    vi.spyOn(FinancialAuditWriter.prototype, "record").mockRejectedValueOnce(new Error("audit unavailable"));
    const res = await provision(a, body(t.id, g), key());
    expect(res.status).toBe(500);
    expect(await accountsFor(t.id)).toHaveLength(0);
    expect(await fix.ledgerAccount.count({ where: { tenantId: t.id } })).toBe(0);
    expect(await consumedAt(g)).toBeNull();
    expect(await audits(a.userId)).toHaveLength(0);
  });

  it("deferred completeness (BP010): a provisioned account without its ALLOWED audit event is refused", async () => {
    const a = await actor();
    const t = await tenant();
    const g = await grant(a);
    // Checked explicitly: the deferred constraint raises BP010 with its SQLSTATE.
    const code = await pgCode(() =>
      runtime.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE "StepUpGrant" SET "consumedAt" = now() WHERE "id" = $1::uuid`, g);
        await platformContext(tx, a.userId);
        await callProvision(tx, a, g, t.id); // succeeds inside the transaction…
        await tx.$executeRawUnsafe(`SET CONSTRAINTS billing_account_provision_complete IMMEDIATE`);
      }, TX),
    );
    expect(code).toBe("BP010");
    expect(await accountsFor(t.id)).toHaveLength(0);
    expect(await consumedAt(g)).toBeNull();

    // At COMMIT (the normal path): the commit itself is refused and nothing persists.
    const g2 = await grant(a);
    await expect(
      runtime.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE "StepUpGrant" SET "consumedAt" = now() WHERE "id" = $1::uuid`, g2);
        await platformContext(tx, a.userId);
        await callProvision(tx, a, g2, t.id);
      }, TX),
    ).rejects.toThrow();
    expect(await accountsFor(t.id)).toHaveLength(0);
    expect(await fix.ledgerAccount.count({ where: { tenantId: t.id } })).toBe(0);
    expect(await consumedAt(g2)).toBeNull();
  });
});

describe("restricted runtime role — no bypass of the provisioning invariants", () => {
  it("cannot read the financial audit, write BillingAccount, or open a ledger account directly (42501)", async () => {
    const t = await tenant();
    expect(await pgCode(() => runtime.$queryRawUnsafe(`SELECT 1 FROM "FinancialAuditEvent" LIMIT 1`))).toBe("42501");
    expect(await pgCode(() => runtime.$queryRawUnsafe(`SELECT 1 FROM "BillingAccount" LIMIT 1`))).toBe("42501");
    expect(
      await pgCode(() =>
        runtime.$executeRawUnsafe(
          `INSERT INTO "BillingAccount"("tenantId","accountNumber","label","currency","mode","provisioningKey","provisioningFingerprint","updatedAt")
           VALUES ($1::uuid,$2,'x','USD','PREPAID',$3,$4,now())`,
          t.id,
          `BA-${YEAR}-${generateAccountNumberSuffix()}`,
          key(),
          `v1:${"0".repeat(64)}`,
        ),
      ),
    ).toBe("42501");
    expect(
      await pgCode(() => runtime.$queryRawUnsafe(`SELECT billing.ledger_account_open(uuidv7(), $1::uuid, 'USD'::"Currency", 'customer_funds')`, t.id)),
    ).toBe("42501");
  });

  it("calling the function directly without a grant consumed in the same transaction is refused (BP003)", async () => {
    const a = await actor();
    const t = await tenant();
    const g = await grant(a);
    const code = await pgCode(() =>
      runtime.$transaction(async (tx) => {
        await platformContext(tx, a.userId);
        await callProvision(tx, a, g, t.id);
      }, TX),
    );
    expect(code).toBe("BP003");
    expect(await accountsFor(t.id)).toHaveLength(0);
  });

  it("a grant consumed in an EARLIER transaction does not authorize a direct call (BP003)", async () => {
    const a = await actor();
    const t = await tenant();
    const g = await grant(a);
    await runtime.$executeRawUnsafe(`UPDATE "StepUpGrant" SET "consumedAt" = now() WHERE "id" = $1::uuid`, g);
    const code = await pgCode(() =>
      runtime.$transaction(async (tx) => {
        await platformContext(tx, a.userId);
        await callProvision(tx, a, g, t.id);
      }, TX),
    );
    expect(code).toBe("BP003");
  });

  it("the database re-checks platform membership, MFA and the explicit permission (BP001/BP002)", async () => {
    const t = await tenant();
    const cust = await tenant("CUSTOMER");
    const nonPlatform = await actor({ tenantId: cust.id });
    const noMfa = await actor({ mfa: false });
    const noPerm = await actor({ perm: false, systemRoles: ["owner"] });
    const probe = async (x: Actor) =>
      pgCode(() =>
        runtime.$transaction(async (tx) => {
          const g = await grant(x);
          await tx.$executeRawUnsafe(`UPDATE "StepUpGrant" SET "consumedAt" = now() WHERE "id" = $1::uuid`, g);
          await platformContext(tx, x.userId);
          await callProvision(tx, x, g, t.id);
        }, TX),
      );
    expect(await probe(nonPlatform)).toBe("BP001");
    expect(await probe(noMfa)).toBe("BP001");
    expect(await probe(noPerm)).toBe("BP002");
    // A forged actor id that is not a member of the claimed platform tenant.
    const a = await actor();
    const stranger = await actor();
    expect(
      await pgCode(() =>
        runtime.$transaction(async (tx) => {
          const g = await grant(a);
          await tx.$executeRawUnsafe(`UPDATE "StepUpGrant" SET "consumedAt" = now() WHERE "id" = $1::uuid`, g);
          await platformContext(tx, a.userId);
          await callProvision(tx, { userId: a.userId, tenantId: stranger.tenantId }, g, t.id);
        }, TX),
      ),
    ).toBe("BP001");
    expect(await accountsFor(t.id)).toHaveLength(0);
  });

  it("an account-number collision is detected (BP007) so the service can retry with a fresh suffix", async () => {
    const a = await actor();
    const t1 = await tenant();
    const first = await provision(a, body(t1.id, await grant(a)), key());
    expect(first.status).toBe(201);
    const suffix = String(first.body.accountNumber).slice(-12);
    const t2 = await tenant();
    const code = await pgCode(() =>
      runtime.$transaction(async (tx) => {
        const g = await grant(a);
        await tx.$executeRawUnsafe(`UPDATE "StepUpGrant" SET "consumedAt" = now() WHERE "id" = $1::uuid`, g);
        await platformContext(tx, a.userId);
        await callProvision(tx, a, g, t2.id, { suffix });
      }, TX),
    );
    expect(code).toBe("BP007");
    expect(await accountsFor(t2.id)).toHaveLength(0);
  });

  it("provisioning attribution is immutable, even for the table owner (BA001)", async () => {
    const a = await actor();
    const b = await actor();
    const t = await tenant();
    const res = await provision(a, body(t.id, await grant(a)), key());
    expect(
      await pgCode(() => fix.$executeRawUnsafe(`UPDATE "BillingAccount" SET "provisionedByUserId" = $2::uuid WHERE "id" = $1::uuid`, res.body.id, b.userId)),
    ).toBe("BA001");
  });
});

describe("concurrency", () => {
  it("the same key submitted in parallel (fresh grant each) creates exactly one account and one ALLOWED audit", async () => {
    const a = await actor();
    const t = await tenant();
    const idem = key();
    const grants = await Promise.all(Array.from({ length: 5 }, () => grant(a)));
    const results = await Promise.all(grants.map((g) => provision(a, body(t.id, g), idem)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await accountsFor(t.id)).toHaveLength(1);
    expect(await fix.ledgerAccount.count({ where: { tenantId: t.id } })).toBe(1);
    expect(await audits(a.userId, "ALLOWED")).toHaveLength(1);
  });

  it("different keys with the same label in parallel: exactly one succeeds, the rest conflict (409)", async () => {
    const a = await actor();
    const t = await tenant();
    const grants = await Promise.all(Array.from({ length: 4 }, () => grant(a)));
    const results = await Promise.all(grants.map((g) => provision(a, body(t.id, g, { label: "Race" }), key())));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect(await accountsFor(t.id)).toHaveLength(1);
    expect(await audits(a.userId, "ALLOWED")).toHaveLength(1);
    // Losing requests rolled back their grant consumption.
    const consumed = await Promise.all(grants.map(consumedAt));
    expect(consumed.filter((c) => c !== null)).toHaveLength(1);
  });
});

describe("step-up issuance endpoint (O1)", () => {
  const codeAt = (secret: string, offset = 0) => authenticator.clone({ epoch: Date.now() + offset * 30_000 }).generate(secret);
  const issue = (a: Actor, b: Record<string, unknown>) =>
    request(http).post("/v1/auth/step-up").set("Authorization", `Bearer ${a.token}`).send(b);

  it("issues a single-use, 300 s grant from a TOTP code, usable once for provisioning", async () => {
    const a = await actor();
    const t = await tenant();
    const res = await issue(a, { purpose: PURPOSE, code: codeAt(a.secret) });
    expect(res.status).toBe(201);
    expect(res.body.purpose).toBe(PURPOSE);
    const ttl = (new Date(res.body.expiresAt).getTime() - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(250);
    expect(ttl).toBeLessThanOrEqual(301);
    const row = await fix.stepUpGrant.findUniqueOrThrow({ where: { id: res.body.grantId } });
    expect(row).toMatchObject({ userId: a.userId, sessionId: a.sessionId, tenantId: a.tenantId, purpose: PURPOSE, consumedAt: null });
    expect((await provision(a, body(t.id, res.body.grantId), key())).status).toBe(201);
    expect((await provision(a, body(t.id, res.body.grantId, { label: "Second" }), key())).status).toBe(403);
  });

  it("refuses a replayed TOTP code, a wrong code, an unknown purpose and a recovery code", async () => {
    const a = await actor();
    const code = codeAt(a.secret);
    expect((await issue(a, { purpose: PURPOSE, code })).status).toBe(201);
    expect((await issue(a, { purpose: PURPOSE, code })).status).toBe(403); // replay guard
    const wrong = String((Number(codeAt(a.secret, 5)) + 1) % 1_000_000).padStart(6, "0");
    expect((await issue(a, { purpose: PURPOSE, code: wrong })).status).toBe(403);
    expect((await issue(a, { purpose: "billing_account.other_op", code: codeAt(a.secret, 1) })).status).toBe(403);
    expect((await issue(a, { purpose: PURPOSE, code: "ABCD-EFGH-IJKL" })).status).toBe(400); // recovery codes are not step-up factors
    expect((await issue(a, { purpose: PURPOSE, code: codeAt(a.secret, -1), extra: 1 })).status).toBe(400);
    expect(await fix.stepUpGrant.count({ where: { userId: a.userId } })).toBe(1);
    expect(await fix.securityEvent.count({ where: { userId: a.userId, type: "step_up.failed" } })).toBeGreaterThanOrEqual(3);
  });

  it("a user without MFA cannot obtain a grant (403)", async () => {
    const a = await actor({ mfa: false });
    expect((await issue(a, { purpose: PURPOSE, code: codeAt(a.secret) })).status).toBe(403);
    expect(await fix.stepUpGrant.count({ where: { userId: a.userId } })).toBe(0);
  });
});
