import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import { MfaService } from "./mfa.service";

/**
 * Financial step-up lifetime — OWNER-APPROVED 2026-11-26 (Phase 13-2B S1,
 * decision G1): one value covering freshness and grant lifetime. The database
 * enforces the same bound (CHECK StepUpGrant_lifetime_chk); changing it needs an
 * owner decision AND a migration.
 */
export const STEP_UP_GRANT_TTL_SECONDS = 300;

/** Server-defined purpose identifiers (mirrors the DB CHECK). */
export const STEP_UP_PURPOSE_PATTERN = /^[a-z][a-z0-9_.]{2,63}$/;

export type StepUpFailure = "invalid_purpose" | "not_eligible" | "invalid_code" | "step_up_required";

/**
 * Thrown on every step-up failure. The reason is for server-side handling and
 * tests; callers must map it to a generic 401/403 without echoing detail.
 */
export class StepUpError extends Error {
  constructor(readonly reason: StepUpFailure) {
    super(`Step-up verification failed (${reason})`);
    this.name = "StepUpError";
  }
}

export interface StepUpBinding {
  /** Server-derived actor (JWT `sub`), never client input. */
  userId: string;
  /** Server-derived session (JWT `sid`). */
  sessionId: string;
  /** Server-derived active tenant (TenantContext). */
  tenantId: string;
  /** Server-defined operation purpose (e.g. "billing_account.provision"). */
  purpose: string;
}

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Server-side financial step-up (ADR-0022 Amendment 5 BA-15, Phase 13-2B S1).
 *
 * `issue` verifies a FRESH TOTP code (recovery codes are not accepted here; the
 * TOTP replay guard applies) for an active user with MFA, on a live session
 * whose active tenant is the bound tenant and with an ACTIVE membership in it,
 * then records a grant bound to user + session + tenant + purpose, expiring
 * after STEP_UP_GRANT_TTL_SECONDS (database clock).
 *
 * `consume` atomically single-uses a grant: one UPDATE that re-checks every
 * binding, expiry (strict), session liveness, user status and MFA — so a
 * replayed, expired, foreign-session, foreign-tenant, wrong-purpose or revoked
 * grant fails closed, and two concurrent consumers cannot both succeed. It can
 * run inside the caller's transaction (so the protected change and the grant
 * consumption commit or roll back together).
 *
 * INERT in S1: no controller exposes it and no operation requires it yet. The
 * client never supplies identity, timestamps or authorization claims.
 */
@Injectable()
export class StepUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
  ) {}

  async issue(binding: StepUpBinding, code: string): Promise<{ grantId: string; expiresAt: Date }> {
    if (!STEP_UP_PURPOSE_PATTERN.test(binding.purpose)) throw new StepUpError("invalid_purpose");
    if (!(await this.isEligible(binding))) throw new StepUpError("not_eligible");
    if (!(await this.mfa.verifyTotpOnly(binding.userId, code))) throw new StepUpError("invalid_code");

    const rows = await this.prisma.$queryRaw<Array<{ id: string; expiresAt: Date }>>`
      INSERT INTO "StepUpGrant" ("userId", "sessionId", "tenantId", "purpose", "expiresAt")
      VALUES (${binding.userId}::uuid, ${binding.sessionId}::uuid, ${binding.tenantId}::uuid, ${binding.purpose},
              now() + make_interval(secs => ${STEP_UP_GRANT_TTL_SECONDS}))
      RETURNING "id", "expiresAt"`;
    return { grantId: rows[0].id, expiresAt: rows[0].expiresAt };
  }

  async consume(grantId: string, binding: StepUpBinding, db: Db = this.prisma): Promise<void> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      UPDATE "StepUpGrant" g SET "consumedAt" = now()
      FROM "Session" s, "User" u
      WHERE g."id" = ${grantId}::uuid
        AND g."userId" = ${binding.userId}::uuid
        AND g."sessionId" = ${binding.sessionId}::uuid
        AND g."tenantId" = ${binding.tenantId}::uuid
        AND g."purpose" = ${binding.purpose}
        AND g."consumedAt" IS NULL
        AND g."expiresAt" > now()
        AND s."id" = g."sessionId" AND s."userId" = g."userId"
        AND s."revokedAt" IS NULL AND s."expiresAt" > now()
        AND u."id" = g."userId" AND u."status" = 'ACTIVE' AND u."deletedAt" IS NULL AND u."mfaEnabled"
      RETURNING g."id"`;
    if (rows.length !== 1) throw new StepUpError("step_up_required");
  }

  /** Live session of this user, bound to this tenant; active user with MFA; active membership. */
  private async isEligible(b: StepUpBinding): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ ok: number }>>`
      SELECT 1 AS ok
      FROM "Session" s
      JOIN "User" u ON u."id" = s."userId"
      JOIN "Membership" m ON m."userId" = u."id" AND m."tenantId" = ${b.tenantId}::uuid
      JOIN "Tenant" t ON t."id" = m."tenantId"
      WHERE s."id" = ${b.sessionId}::uuid AND s."userId" = ${b.userId}::uuid
        AND s."tenantId" = ${b.tenantId}::uuid
        AND s."revokedAt" IS NULL AND s."expiresAt" > now()
        AND u."status" = 'ACTIVE' AND u."deletedAt" IS NULL AND u."mfaEnabled"
        AND m."status" = 'ACTIVE' AND m."deletedAt" IS NULL
        AND t."status" = 'ACTIVE' AND t."deletedAt" IS NULL`;
    return rows.length === 1;
  }
}
