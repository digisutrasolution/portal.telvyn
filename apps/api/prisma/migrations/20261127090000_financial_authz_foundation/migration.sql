-- =============================================================================
-- Phase 13-2B, Slice S1 — financial authorization foundation (INERT).
-- Implements ADR-0022 Amendment 5 BA-08 (retire wallet.credit) and BA-15
-- (server-side step-up grant + TOTP replay guard); owner decisions G1 (300 s
-- grant lifetime), G2 (this migration + narrow runtime grants) — 2026-11-26.
--
-- Part A (Prisma-managed DDL): User."mfaLastTotpStep", the StepUpGrant table,
--   its indexes and FKs (all ON DELETE RESTRICT — grants are evidence).
-- Part B (raw SQL — not expressible in schema.prisma, verified by
--   scripts/db/ledger-drift-check.sql): CHECKs (purpose format, 300 s lifetime),
--   the billing.step_up_grant_guard trigger, wallet.credit retirement, and the
--   runtime privilege matrix (SELECT, INSERT, UPDATE("consumedAt") only).
--
-- INERT: StepUpService has no endpoint and no operation requires a grant yet.
-- Runs as telvyn_migrator (owner of schema "billing"); no extra capability.
-- =============================================================================

-- ======================= PART A — Prisma-managed DDL =========================
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaLastTotpStep" INTEGER;

-- CreateTable
CREATE TABLE "StepUpGrant" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepUpGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StepUpGrant_userId_sessionId_idx" ON "StepUpGrant"("userId", "sessionId");

-- CreateIndex
CREATE INDEX "StepUpGrant_tenantId_idx" ON "StepUpGrant"("tenantId");

-- CreateIndex
CREATE INDEX "StepUpGrant_expiresAt_idx" ON "StepUpGrant"("expiresAt");

-- AddForeignKey
ALTER TABLE "StepUpGrant" ADD CONSTRAINT "StepUpGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepUpGrant" ADD CONSTRAINT "StepUpGrant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepUpGrant" ADD CONSTRAINT "StepUpGrant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ========================= PART B — raw SQL invariants ======================
-- B1. Purpose is a bounded, server-defined identifier (e.g. "billing_account.provision").
ALTER TABLE "StepUpGrant" ADD CONSTRAINT "StepUpGrant_purpose_format_chk"
  CHECK ("purpose" ~ '^[a-z][a-z0-9_.]{2,63}$');

-- B2. Lifetime: strictly after issuance and at most 300 s (owner decision G1).
--     Defense in depth: even a faulty caller cannot mint a longer-lived grant.
ALTER TABLE "StepUpGrant" ADD CONSTRAINT "StepUpGrant_lifetime_chk"
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '300 seconds');

-- B3. Guard trigger (SECURITY INVOKER, hardened search_path). SQLSTATEs:
--       SG001 binding immutable (id, user, session, tenant, purpose, expiry, issuance)
--       SG002 single-use: consumedAt is set exactly once and never cleared
--       SG003 a new grant cannot be inserted already consumed
--     createdAt and consumedAt are stamped from the database clock (client
--     values ignored), so the lifetime CHECK is measured against DB time.
CREATE FUNCTION "billing"."step_up_grant_guard"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."consumedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'a step-up grant cannot be issued already consumed' USING ERRCODE = 'SG003';
    END IF;
    NEW."createdAt" := now();
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW."id" <> OLD."id"
     OR NEW."userId" <> OLD."userId"
     OR NEW."sessionId" <> OLD."sessionId"
     OR NEW."tenantId" <> OLD."tenantId"
     OR NEW."purpose" <> OLD."purpose"
     OR NEW."expiresAt" <> OLD."expiresAt"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'step-up grant binding is immutable' USING ERRCODE = 'SG001';
  END IF;
  IF OLD."consumedAt" IS NOT NULL OR NEW."consumedAt" IS NULL THEN
    RAISE EXCEPTION 'a step-up grant is single-use' USING ERRCODE = 'SG002';
  END IF;
  NEW."consumedAt" := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "step_up_grant_guard" BEFORE INSERT OR UPDATE ON "StepUpGrant"
  FOR EACH ROW EXECUTE FUNCTION "billing"."step_up_grant_guard"();

-- B4. Retire wallet.credit (BA-08). No route ever required it; remove every
--     stored grant (system and custom roles) and the permission row. The catalog
--     no longer declares it, so a re-seed cannot recreate it.
DELETE FROM "RolePermission"
  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "key" = 'wallet.credit');
DELETE FROM "Permission" WHERE "key" = 'wallet.credit';

-- B5. Least privilege (owner decision G2): runtime may read and issue grants and
--     stamp consumedAt — nothing else. No DELETE, no UPDATE of any other column.
--     The grant scripts handle StepUpGrant explicitly (never the generic loop).
REVOKE ALL ON "StepUpGrant" FROM PUBLIC;
REVOKE ALL ON "StepUpGrant" FROM telvyn_app;
GRANT SELECT, INSERT ON "StepUpGrant" TO telvyn_app;
GRANT UPDATE ("consumedAt") ON "StepUpGrant" TO telvyn_app;
