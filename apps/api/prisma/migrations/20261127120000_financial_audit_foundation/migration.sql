-- =============================================================================
-- Phase 13-2B, Slice S2 — financial audit foundation (INERT).
-- Implements ADR-0022 Amendment 5 BA-14 (dedicated append-only financial audit
-- table, same-transaction write, fail closed); owner decisions F1–F7
-- (2026-11-27).
--
-- Part A (Prisma-managed DDL): the FinancialAuditDecision enum, the
--   FinancialAuditEvent table, its indexes and FKs (all ON DELETE RESTRICT and
--   ON UPDATE RESTRICT — audit rows are evidence). The BillingAccount FK is the
--   composite (billingAccountId, tenantId) -> BillingAccount(id, tenantId), so a
--   cross-tenant account reference is not representable (F4).
-- Part B (raw SQL — not expressible in schema.prisma, verified by
--   scripts/db/ledger-drift-check.sql): format and size CHECKs (F1/F5), the
--   billing.financial_audit_event_guard triggers (append-only + attribution,
--   F3/F4/F6) and the runtime privilege matrix (SELECT + INSERT only, F6).
--
-- INERT: the application operation catalog is empty in S2 (F1), so no
-- production code path writes a row. Runs as telvyn_migrator (owner of schema
-- "billing"); no extra capability. Honest limit: the table owner / superuser
-- can still disable triggers — immutability is enforced against the runtime
-- role, not against privileged administrators.
-- =============================================================================

-- ======================= PART A — Prisma-managed DDL =========================
-- CreateEnum
CREATE TYPE "FinancialAuditDecision" AS ENUM ('ALLOWED', 'DENIED');

-- CreateTable
CREATE TABLE "FinancialAuditEvent" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "operation" TEXT NOT NULL,
    "decision" "FinancialAuditDecision" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "actorTenantId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "billingAccountId" UUID,
    "permission" TEXT,
    "stepUpGrantId" UUID,
    "reasonCode" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "details" JSONB,
    "idempotencyKey" TEXT,
    "ledgerTransactionId" UUID,
    "correlationId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialAuditEvent_tenantId_createdAt_idx" ON "FinancialAuditEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialAuditEvent_billingAccountId_createdAt_idx" ON "FinancialAuditEvent"("billingAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialAuditEvent_actorUserId_createdAt_idx" ON "FinancialAuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialAuditEvent_actorTenantId_createdAt_idx" ON "FinancialAuditEvent"("actorTenantId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialAuditEvent_stepUpGrantId_idx" ON "FinancialAuditEvent"("stepUpGrantId");

-- CreateIndex
CREATE INDEX "FinancialAuditEvent_ledgerTransactionId_idx" ON "FinancialAuditEvent"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "FinancialAuditEvent_correlationId_idx" ON "FinancialAuditEvent"("correlationId");

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_actorTenantId_fkey" FOREIGN KEY ("actorTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_billingAccountId_tenantId_fkey" FOREIGN KEY ("billingAccountId", "tenantId") REFERENCES "BillingAccount"("id", "tenantId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_stepUpGrantId_fkey" FOREIGN KEY ("stepUpGrantId") REFERENCES "StepUpGrant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ========================= PART B — raw SQL invariants ======================
-- B1. Identifier formats (F1/F5): operation and permission are server-defined
--     dotted identifiers; reasonCode is an upper-case machine code — no free text.
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_operation_format_chk"
  CHECK ("operation" ~ '^[a-z][a-z0-9_.]{2,63}$');
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_permission_format_chk"
  CHECK ("permission" IS NULL OR "permission" ~ '^[a-z][a-z0-9_.]{2,63}$');
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_reason_code_format_chk"
  CHECK ("reasonCode" ~ '^[A-Z][A-Z0-9_]{2,63}$');
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_correlation_id_len_chk"
  CHECK ("correlationId" IS NULL OR char_length("correlationId") BETWEEN 1 AND 128);

-- B2. Structured metadata (F5): before/after/details are each NULL or a plain
--     JSON object of at most 4096 bytes (jsonb text form) and 50 top-level keys
--     — the existing FraudEvent bound. The writer enforces the same limits and
--     the sensitive-key denylist before the insert; this is defense in depth.
CREATE FUNCTION "billing"."financial_audit_json_ok"(j jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT j IS NULL
      OR (jsonb_typeof(j) = 'object'
          AND octet_length(j::text) <= 4096
          AND (SELECT count(*) FROM jsonb_object_keys(j)) <= 50)
$fn$;
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_before_shape_chk"
  CHECK ("billing"."financial_audit_json_ok"("before"));
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_after_shape_chk"
  CHECK ("billing"."financial_audit_json_ok"("after"));
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_details_shape_chk"
  CHECK ("billing"."financial_audit_json_ok"("details"));

-- B3. Guard triggers (SECURITY INVOKER, hardened search_path). SQLSTATEs:
--       FA001 rows are immutable (UPDATE refused)
--       FA002 rows are never deleted (DELETE refused)
--       FA003 the table is never truncated (TRUNCATE refused)
--       FA004 actor tenant must equal the owner tenant unless it is PLATFORM (F4)
--       FA005 a referenced step-up grant must belong to the actor and actor tenant
--     createdAt is stamped from the database clock (client value ignored).
--     These fire for the table owner too; only a superuser / owner disabling
--     the triggers bypasses them (documented limit).
CREATE FUNCTION "billing"."financial_audit_event_guard"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'financial audit events are never truncated' USING ERRCODE = 'FA003';
  ELSIF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'financial audit events are immutable' USING ERRCODE = 'FA001';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'financial audit events are never deleted' USING ERRCODE = 'FA002';
  END IF;

  -- INSERT
  IF NEW."actorTenantId" <> NEW."tenantId" AND NOT EXISTS (
       SELECT 1 FROM public."Tenant" t
        WHERE t."id" = NEW."actorTenantId" AND t."type" = 'PLATFORM'::public."TenantType") THEN
    RAISE EXCEPTION 'a non-platform actor can only be attributed to its own tenant' USING ERRCODE = 'FA004';
  END IF;
  IF NEW."stepUpGrantId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public."StepUpGrant" g
        WHERE g."id" = NEW."stepUpGrantId"
          AND g."userId" = NEW."actorUserId"
          AND g."tenantId" = NEW."actorTenantId") THEN
    RAISE EXCEPTION 'step-up grant does not belong to the audited actor' USING ERRCODE = 'FA005';
  END IF;
  NEW."createdAt" := now();
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "financial_audit_event_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FinancialAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "billing"."financial_audit_event_guard"();
CREATE TRIGGER "financial_audit_event_no_truncate" BEFORE TRUNCATE ON "FinancialAuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "billing"."financial_audit_event_guard"();

-- B4. Least privilege (F6, BA-14): runtime may read and append — nothing else.
--     No UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER; PUBLIC has nothing.
--     The grant scripts handle FinancialAuditEvent explicitly (never the
--     generic loop).
REVOKE ALL ON "FinancialAuditEvent" FROM PUBLIC;
REVOKE ALL ON "FinancialAuditEvent" FROM telvyn_app;
GRANT SELECT, INSERT ON "FinancialAuditEvent" TO telvyn_app;
