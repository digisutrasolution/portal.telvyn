-- =============================================================================
-- Phase 13-2B, Slice S3 — BillingAccount database foundation (INERT).
-- Implements ADR-0022 Amendment 5: BA-01, BA-02, BA-04, BA-05, BA-06 (database
-- part only), BA-13, X-1; owner S3 decisions S3-D1..D4 and E (2026-11-26).
-- Additive only: two enums + one table; no existing object is altered.
--
-- Part A (Prisma-managed DDL): enums, table, FKs, plain/composite unique indexes.
-- Part B (raw SQL — not expressible in schema.prisma, verified by
--   scripts/db/ledger-drift-check.sql): partial unique indexes, CHECKs, the
--   billing.billing_account_guard trigger, and the runtime-privilege revoke.
--
-- INERT: no endpoint, service, caller or row exists in S3. The runtime role
-- (telvyn_app) receives NO privilege on "BillingAccount" (owner decision E).
-- Runs as telvyn_migrator (owner of schema "billing" since the ledger
-- migration); needs no additional deployment capability.
-- =============================================================================

-- ======================= PART A — Prisma-managed DDL =========================
-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('PREPAID', 'POSTPAID');

-- CreateEnum
CREATE TYPE "BillingAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED');

-- CreateTable
CREATE TABLE "BillingAccount" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "mode" "BillingMode" NOT NULL,
    "status" "BillingAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusChangedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "successorOfId" UUID,
    "provisioningKey" TEXT NOT NULL,
    "provisioningFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_accountNumber_key" ON "BillingAccount"("accountNumber");

-- CreateIndex
CREATE INDEX "BillingAccount_tenantId_status_idx" ON "BillingAccount"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_id_tenantId_key" ON "BillingAccount"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_successorOfId_tenantId_key" ON "BillingAccount"("successorOfId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_tenantId_provisioningKey_key" ON "BillingAccount"("tenantId", "provisioningKey");

-- AddForeignKey
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_successorOfId_tenantId_fkey" FOREIGN KEY ("successorOfId", "tenantId") REFERENCES "BillingAccount"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===================== PART B — raw BillingAccount integrity SQL ==============

-- B1. Label (S3-D1): required and non-blank after trimming surrounding spaces.
ALTER TABLE "BillingAccount"
  ADD CONSTRAINT "BillingAccount_label_nonblank_chk" CHECK (btrim("label") <> '');

-- B2. Lineage (S3-D2): an account cannot succeed itself. Same-tenant lineage is
--     the composite FK above; one successor per account is the unique
--     ("successorOfId","tenantId") index above (NULLs distinct: roots allowed).
ALTER TABLE "BillingAccount"
  ADD CONSTRAINT "BillingAccount_no_self_succession_chk"
  CHECK ("successorOfId" IS NULL OR "successorOfId" <> "id");

-- B3. At most one default account per (tenant, currency) among ACTIVE/SUSPENDED
--     accounts (BA-02). Partial index — not representable in schema.prisma.
CREATE UNIQUE INDEX "BillingAccount_tenantId_currency_default_key"
  ON "BillingAccount"("tenantId", "currency")
  WHERE "isDefault" AND "status" IN ('ACTIVE', 'SUSPENDED');

-- B4. Label unique per tenant ignoring case and surrounding spaces among
--     non-CLOSED accounts (BA-02, S3-D1). Partial expression index.
CREATE UNIQUE INDEX "BillingAccount_tenantId_label_open_key"
  ON "BillingAccount"("tenantId", lower(btrim("label")))
  WHERE "status" <> 'CLOSED';

-- B5. Integrity guard (BA-01/04/05/06, S3-D2/D3/D4). SECURITY INVOKER, hardened
--     search_path, objects schema-qualified. Fires for every role, including the
--     table owner. Custom SQLSTATEs:
--       BA001 identity immutable (id, owner, number, currency, mode, lineage,
--             provisioning key/fingerprint)
--       BA002 CLOSED is terminal (status can never change once CLOSED)
--       BA003 a new account must start ACTIVE
--       BA004 owner tenant must be CUSTOMER or RESELLER (a FK cannot express it)
--     statusChangedAt is maintained by the database: stamped on insert and on
--     every status change, otherwise preserved (cannot be set arbitrarily).
--     The full lifecycle transition matrix is NOT enforced here (S6, S3-D3).
CREATE FUNCTION "billing"."billing_account_guard"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'a new billing account must start ACTIVE' USING ERRCODE = 'BA003';
    END IF;
    SELECT t."type"::text INTO v_type FROM public."Tenant" t WHERE t."id" = NEW."tenantId";
    IF v_type IS NOT NULL AND v_type NOT IN ('CUSTOMER', 'RESELLER') THEN
      RAISE EXCEPTION 'billing account owner must be a CUSTOMER or RESELLER tenant'
        USING ERRCODE = 'BA004';
    END IF;
    -- (a missing tenant is left to the FK: 23503)
    NEW."statusChangedAt" := now();
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW."id" <> OLD."id"
     OR NEW."tenantId" <> OLD."tenantId"
     OR NEW."accountNumber" <> OLD."accountNumber"
     OR NEW."currency" <> OLD."currency"
     OR NEW."mode" <> OLD."mode"
     OR NEW."successorOfId" IS DISTINCT FROM OLD."successorOfId"
     OR NEW."provisioningKey" <> OLD."provisioningKey"
     OR NEW."provisioningFingerprint" <> OLD."provisioningFingerprint" THEN
    RAISE EXCEPTION 'billing account identity is immutable (owner/number/currency/mode/lineage/provisioning)'
      USING ERRCODE = 'BA001';
  END IF;
  IF OLD."status" = 'CLOSED' AND NEW."status" <> 'CLOSED' THEN
    RAISE EXCEPTION 'a CLOSED billing account cannot change status' USING ERRCODE = 'BA002';
  END IF;
  IF NEW."status" <> OLD."status" THEN
    NEW."statusChangedAt" := now();
  ELSE
    NEW."statusChangedAt" := OLD."statusChangedAt";
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "billing_account_guard" BEFORE INSERT OR UPDATE ON "BillingAccount"
  FOR EACH ROW EXECUTE FUNCTION "billing"."billing_account_guard"();

-- B6. Least privilege (owner decision E): the runtime role holds NO privilege on
--     BillingAccount in S3. Explicit, and the grant scripts exclude the table
--     from their generic loop. Later slices grant exactly: SELECT+INSERT (S5),
--     column-level UPDATE (S6), never DELETE (BA-13).
REVOKE ALL ON "BillingAccount" FROM PUBLIC;
REVOKE ALL ON "BillingAccount" FROM telvyn_app;
