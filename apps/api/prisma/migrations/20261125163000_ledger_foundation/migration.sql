-- =============================================================================
-- Phase 13, Slice 13-1B+C — Atomic financial ledger foundation.
-- Implements ADR-0022 (Accepted) / docs/LEDGER_FOUNDATION.md (LF-01..LF-10,
-- R1..R6). Additive, financial-integrity migration.
--
-- Part A (Prisma-managed DDL): the four ledger tables, enums, FKs, indexes.
-- Part B (raw SQL — not expressible in schema.prisma, LF §20): the `billing`
--   schema, amount CHECK bounds, NULLS NOT DISTINCT unique indexes, the deferred
--   balancing + idempotency-completeness CONSTRAINT triggers, the immutability
--   triggers, the restricted SECURITY DEFINER `billing.ledger_post` function, its
--   ownership transfer to telvyn_ledger_fn, and the least-privilege grants.
--
-- DEPLOYMENT PRECONDITIONS (ownership-transfer lifecycle, LF §20 / slice §20-21).
--   This migration runs as telvyn_migrator and requires the bootstrap admin to
--   have granted, BEFORE `prisma migrate deploy`:
--     GRANT CREATE ON DATABASE <db> TO telvyn_migrator;                 -- CREATE SCHEMA billing
--     GRANT telvyn_ledger_fn TO telvyn_migrator WITH INHERIT FALSE, SET TRUE;  -- ALTER FUNCTION OWNER
--   and to REVOKE both AFTER the migration window (scripts/db/ledger-migration-pre.sql
--   and ledger-migration-post.sql). telvyn_ledger_fn (NOLOGIN) and telvyn_app must
--   already exist (ledger-dev-bootstrap.sql / ci-bootstrap-roles.sql). The whole
--   file is applied in one transaction by `prisma migrate deploy`, so either the
--   entire protected ledger (tables + triggers + function + ACL) installs, or none
--   does — no committed intermediate state exposes an unprotected ledger.
-- =============================================================================

-- ======================= PART A — Prisma-managed DDL =========================

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY');

-- CreateEnum
CREATE TYPE "LedgerNormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerAccountStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID,
    "currency" "Currency" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "normalBalance" "LedgerNormalBalance" NOT NULL,
    "status" "LedgerAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "retiredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "operation" TEXT NOT NULL,
    "ownerTenantId" UUID,
    "currency" "Currency" NOT NULL,
    "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
    "correlationId" TEXT,
    "sourceType" TEXT,
    "sourceRef" TEXT,
    "actorId" UUID,
    "reversalOfId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerLeg" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "fingerprintVersion" INTEGER NOT NULL,
    "resultTransactionId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerAccount_tenantId_type_idx" ON "LedgerAccount"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_id_currency_key" ON "LedgerAccount"("id", "currency");

-- CreateIndex
CREATE INDEX "LedgerTransaction_ownerTenantId_effectiveAt_idx" ON "LedgerTransaction"("ownerTenantId", "effectiveAt");

-- CreateIndex
CREATE INDEX "LedgerTransaction_correlationId_idx" ON "LedgerTransaction"("correlationId");

-- CreateIndex
CREATE INDEX "LedgerLeg_transactionId_idx" ON "LedgerLeg"("transactionId");

-- CreateIndex
CREATE INDEX "LedgerLeg_accountId_idx" ON "LedgerLeg"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_resultTransactionId_key" ON "IdempotencyKey"("resultTransactionId");

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_ownerTenantId_fkey" FOREIGN KEY ("ownerTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerLeg" ADD CONSTRAINT "LedgerLeg_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerLeg" ADD CONSTRAINT "LedgerLeg_accountId_currency_fkey" FOREIGN KEY ("accountId", "currency") REFERENCES "LedgerAccount"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_resultTransactionId_fkey" FOREIGN KEY ("resultTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================== PART B — raw financial-integrity SQL ===================
-- Everything below is not expressible in schema.prisma and is verified by the
-- drift check (scripts/db/ledger-drift-check.sql), not by Prisma schema-diff.

-- B0. Dedicated schema for the restricted posting function + integrity triggers.
--     (Ledger TABLES remain in `public`, Prisma-managed; the function and trigger
--     functions live in `billing` and reference the tables schema-qualified.)
CREATE SCHEMA "billing";

-- B1. Signed-micros bound + non-zero CHECK (LF-01/R5). The ±1e15 bound keeps
--     reversal negation representable and rejects MIN-BIGINT.
ALTER TABLE "LedgerLeg"
  ADD CONSTRAINT "LedgerLeg_amountMicros_nonzero_bounded_chk"
  CHECK ("amountMicros" <> 0 AND "amountMicros" BETWEEN -1000000000000000 AND 1000000000000000);

-- B2. NULL-safe natural-identity uniques (PG18 NULLS NOT DISTINCT) so platform
--     (null tenant) rows are also deduped without a sentinel. Index names match
--     the @@unique() Prisma would emit (schema.prisma declares them plain).
CREATE UNIQUE INDEX "LedgerAccount_tenantId_currency_code_key"
  ON "LedgerAccount"("tenantId", "currency", "code") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "IdempotencyKey_tenantId_operation_key_key"
  ON "IdempotencyKey"("tenantId", "operation", "key") NULLS NOT DISTINCT;

-- B3. Immutable financial history (R1/R2/LF-04). Shared BEFORE UPDATE/DELETE guard
--     for posted transactions and legs.
CREATE FUNCTION "billing"."ledger_immutable"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION 'ledger %.% is immutable (% denied)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'LG010';
END
$fn$;

CREATE TRIGGER "ledger_tx_immutable" BEFORE UPDATE OR DELETE ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION "billing"."ledger_immutable"();
CREATE TRIGGER "ledger_leg_immutable" BEFORE UPDATE OR DELETE ON "LedgerLeg"
  FOR EACH ROW EXECUTE FUNCTION "billing"."ledger_immutable"();

-- B4. Late-leg / reopen guard (LF §14-15): a leg may only be inserted in the same
--     transaction that created its header. age(xmin)=0 ⇔ header created by the
--     current transaction; any older (committed) header is immutable.
CREATE FUNCTION "billing"."ledger_leg_insert_guard"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_age int;
BEGIN
  SELECT age(t.xmin) INTO v_age FROM public."LedgerTransaction" t WHERE t."id" = NEW."transactionId";
  IF v_age IS NULL THEN
    RETURN NEW;  -- missing header: let the FK reject it
  END IF;
  IF v_age <> 0 THEN
    RAISE EXCEPTION 'cannot add a leg to an existing ledger transaction (immutable history)'
      USING ERRCODE = 'LG010';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "ledger_leg_insert_guard" BEFORE INSERT ON "LedgerLeg"
  FOR EACH ROW EXECUTE FUNCTION "billing"."ledger_leg_insert_guard"();

-- B5. Immutable ledger-account identity (R1): ownership, currency, type,
--     normalBalance, code never change; retired accounts never reactivate.
CREATE FUNCTION "billing"."ledger_account_guard"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF NEW."id" <> OLD."id"
     OR NEW."currency" <> OLD."currency"
     OR NEW."code" <> OLD."code"
     OR NEW."type" <> OLD."type"
     OR NEW."normalBalance" <> OLD."normalBalance"
     OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId" THEN
    RAISE EXCEPTION 'ledger account identity is immutable (ownership/currency/type/normalBalance/code)'
      USING ERRCODE = 'LG011';
  END IF;
  IF OLD."status" = 'RETIRED' AND NEW."status" <> 'RETIRED' THEN
    RAISE EXCEPTION 'a retired ledger account cannot be reactivated' USING ERRCODE = 'LG011';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "ledger_account_guard" BEFORE UPDATE ON "LedgerAccount"
  FOR EACH ROW EXECUTE FUNCTION "billing"."ledger_account_guard"();

-- B6. Completed idempotency records are immutable; identity columns are fixed;
--     only the claim→complete linkage (resultTransactionId NULL→value) may change.
CREATE FUNCTION "billing"."idempotency_guard"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."resultTransactionId" IS NOT NULL THEN
      RAISE EXCEPTION 'completed idempotency keys cannot be deleted' USING ERRCODE = 'LG012';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."resultTransactionId" IS NOT NULL THEN
    RAISE EXCEPTION 'completed idempotency keys are immutable' USING ERRCODE = 'LG012';
  END IF;
  IF NEW."id" <> OLD."id"
     OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."operation" <> OLD."operation"
     OR NEW."key" <> OLD."key"
     OR NEW."requestFingerprint" <> OLD."requestFingerprint"
     OR NEW."fingerprintVersion" <> OLD."fingerprintVersion" THEN
    RAISE EXCEPTION 'idempotency identity is immutable' USING ERRCODE = 'LG012';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "idempotency_guard" BEFORE UPDATE OR DELETE ON "IdempotencyKey"
  FOR EACH ROW EXECUTE FUNCTION "billing"."idempotency_guard"();

-- B7. Deferred balancing/structure check (LF §14-15): at COMMIT, every affected
--     transaction must have >=2 non-zero legs, Σ signed micros = 0 (NUMERIC,
--     overflow-safe), one currency, and ownership consistency. A zero-leg header
--     is also validated because the trigger is on LedgerTransaction.
CREATE FUNCTION "billing"."ledger_tx_validate"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_count   int;
  v_nonzero int;
  v_sum     numeric;
  v_badcur  int;
  v_badown  int;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE l."amountMicros" <> 0),
         coalesce(sum(l."amountMicros"::numeric), 0)
    INTO v_count, v_nonzero, v_sum
    FROM public."LedgerLeg" l
   WHERE l."transactionId" = NEW."id";

  IF v_count < 2 OR v_nonzero < 2 THEN
    RAISE EXCEPTION 'ledger transaction % has fewer than two non-zero legs', NEW."id"
      USING ERRCODE = 'LG001';
  END IF;
  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (Σ micros = %)', NEW."id", v_sum
      USING ERRCODE = 'LG002';
  END IF;

  SELECT count(*) INTO v_badcur
    FROM public."LedgerLeg" l
   WHERE l."transactionId" = NEW."id" AND l."currency" <> NEW."currency";
  IF v_badcur > 0 THEN
    RAISE EXCEPTION 'ledger transaction % mixes currencies', NEW."id" USING ERRCODE = 'LG003';
  END IF;

  SELECT count(*) INTO v_badown
    FROM public."LedgerLeg" l
    JOIN public."LedgerAccount" a ON a."id" = l."accountId"
   WHERE l."transactionId" = NEW."id"
     AND a."tenantId" IS NOT NULL AND a."tenantId" IS DISTINCT FROM NEW."ownerTenantId";
  IF v_badown > 0 THEN
    RAISE EXCEPTION 'ledger transaction % crosses tenant ownership', NEW."id" USING ERRCODE = 'LG004';
  END IF;

  RETURN NULL;
END
$fn$;
CREATE CONSTRAINT TRIGGER "ledger_tx_validate" AFTER INSERT ON "LedgerTransaction"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "billing"."ledger_tx_validate"();

-- B8. Deferred idempotency-completeness check (LF §16): at COMMIT, re-read the
--     FINAL persisted row (not the NEW image from the claim INSERT) and reject a
--     committed claim that never got a result transaction.
CREATE FUNCTION "billing"."idempotency_complete"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_result uuid;
BEGIN
  SELECT k."resultTransactionId" INTO v_result
    FROM public."IdempotencyKey" k WHERE k."id" = NEW."id";
  IF NOT FOUND THEN
    RETURN NULL;  -- row removed within the same transaction; nothing to assert
  END IF;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'idempotency key % committed without a result transaction', NEW."id"
      USING ERRCODE = 'LG005';
  END IF;
  RETURN NULL;
END
$fn$;
CREATE CONSTRAINT TRIGGER "idempotency_complete" AFTER INSERT ON "IdempotencyKey"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "billing"."idempotency_complete"();

-- B9. The restricted posting function — the ONLY sanctioned write path (R2/§17).
--     SECURITY DEFINER (owner = telvyn_ledger_fn, set below); hardened search_path;
--     all object references schema-qualified; no dynamic SQL. Authorization is
--     against the trusted, server-derived session context (app.tenant_id /
--     app.is_platform / app.actor_id set by the application from the authenticated
--     session) — caller-supplied ids in the payload never authorize on their own.
CREATE FUNCTION "billing"."ledger_post"(payload jsonb)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_operation    text               := payload->>'operation';
  v_owner        uuid               := NULLIF(payload->>'ownerTenantId', '')::uuid;
  v_currency     public."Currency"  := (payload->>'currency')::public."Currency";
  v_effective    timestamptz        := (payload->>'effectiveAt')::timestamptz;
  v_correlation  text               := payload->>'correlationId';
  v_sourceType   text               := payload->>'sourceType';
  v_sourceRef    text               := payload->>'sourceRef';
  v_actor        uuid               := NULLIF(payload->>'actorId', '')::uuid;
  v_reversalOf   uuid               := NULLIF(payload->>'reversalOfId', '')::uuid;
  v_idemKey      text               := payload->>'idempotencyKey';
  v_fingerprint  text               := payload->>'requestFingerprint';
  v_fpVersion    int                := (payload->>'fingerprintVersion')::int;
  v_legs         jsonb              := payload->'legs';
  v_ctx_tenant   uuid               := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_ctx_platform boolean            := coalesce(current_setting('app.is_platform', true), 'off') = 'on';
  v_ctx_actor    uuid               := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  v_leg_count    int;
  v_sum          numeric;
  v_rowcount     int;
  v_existing     public."IdempotencyKey"%ROWTYPE;
  v_txn          uuid;
BEGIN
  -- 1. Structural input validation.
  IF v_operation IS NULL OR v_operation = '' THEN
    RAISE EXCEPTION 'ledger_post: operation required' USING ERRCODE = 'LG031';
  END IF;
  IF v_idemKey IS NULL OR v_idemKey = '' OR v_fingerprint IS NULL OR v_fingerprint = '' OR v_fpVersion IS NULL THEN
    RAISE EXCEPTION 'ledger_post: idempotency key, fingerprint and version required' USING ERRCODE = 'LG031';
  END IF;
  IF v_currency IS NULL OR v_effective IS NULL THEN
    RAISE EXCEPTION 'ledger_post: currency and effectiveAt required' USING ERRCODE = 'LG031';
  END IF;
  IF v_legs IS NULL OR jsonb_typeof(v_legs) <> 'array' THEN
    RAISE EXCEPTION 'ledger_post: legs[] required' USING ERRCODE = 'LG031';
  END IF;

  -- 2. Authorization against the trusted server-derived context (never payload alone).
  IF v_owner IS NOT NULL THEN
    IF v_ctx_tenant IS NULL OR v_ctx_tenant <> v_owner THEN
      RAISE EXCEPTION 'ledger_post: owner tenant does not match the authenticated session context'
        USING ERRCODE = 'LG030';
    END IF;
  ELSE
    IF NOT v_ctx_platform THEN
      RAISE EXCEPTION 'ledger_post: platform posting requires platform authority in the session context'
        USING ERRCODE = 'LG030';
    END IF;
  END IF;
  IF v_actor IS NOT NULL AND v_ctx_actor IS NOT NULL AND v_actor <> v_ctx_actor THEN
    RAISE EXCEPTION 'ledger_post: actor does not match the authenticated session context'
      USING ERRCODE = 'LG030';
  END IF;
  IF v_operation = 'adjust' AND v_actor IS NULL THEN
    RAISE EXCEPTION 'ledger_post: an adjustment requires an authorized actor' USING ERRCODE = 'LG031';
  END IF;

  -- 3. Leg validation: >=2 legs, each non-zero and within bounds, Σ = 0 (NUMERIC).
  SELECT count(*), coalesce(sum((l->>'amountMicros')::numeric), 0)
    INTO v_leg_count, v_sum
    FROM jsonb_array_elements(v_legs) AS l;
  IF v_leg_count < 2 THEN
    RAISE EXCEPTION 'ledger_post: at least two legs are required' USING ERRCODE = 'LG001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_legs) AS l
    WHERE (l->>'amountMicros') IS NULL
       OR (l->>'amountMicros')::numeric = 0
       OR (l->>'amountMicros')::numeric < -1000000000000000
       OR (l->>'amountMicros')::numeric >  1000000000000000
  ) THEN
    RAISE EXCEPTION 'ledger_post: a leg amount is zero or outside the ±1e15 micro bound' USING ERRCODE = 'LG032';
  END IF;
  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'ledger_post: legs do not balance (Σ micros = %)', v_sum USING ERRCODE = 'LG002';
  END IF;

  -- 3b. Account validation: existence, currency match, ownership ⊆ {owner, platform}.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_legs) AS l
    LEFT JOIN public."LedgerAccount" a ON a."id" = (l->>'accountId')::uuid
    WHERE a."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'ledger_post: unknown account reference' USING ERRCODE = 'LG033';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_legs) AS l
    JOIN public."LedgerAccount" a ON a."id" = (l->>'accountId')::uuid
    WHERE a."currency" <> v_currency
  ) THEN
    RAISE EXCEPTION 'ledger_post: a leg account currency does not match the transaction currency'
      USING ERRCODE = 'LG003';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_legs) AS l
    JOIN public."LedgerAccount" a ON a."id" = (l->>'accountId')::uuid
    WHERE a."tenantId" IS NOT NULL AND a."tenantId" IS DISTINCT FROM v_owner
  ) THEN
    RAISE EXCEPTION 'ledger_post: a leg account is owned by another tenant (cross-tenant posting)'
      USING ERRCODE = 'LG004';
  END IF;

  -- 4. Claim the idempotency key (resultTransactionId NULL for now).
  INSERT INTO public."IdempotencyKey"
    ("id", "tenantId", "operation", "key", "requestFingerprint", "fingerprintVersion", "resultTransactionId", "createdAt")
  VALUES (uuidv7(), v_owner, v_operation, v_idemKey, v_fingerprint, v_fpVersion, NULL, now())
  ON CONFLICT ("tenantId", "operation", "key") DO NOTHING;
  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  IF v_rowcount = 0 THEN
    -- Concurrent/prior claim: the INSERT above blocked until that transaction
    -- ended; re-read the now-resolved row.
    SELECT * INTO v_existing
      FROM public."IdempotencyKey"
     WHERE "tenantId" IS NOT DISTINCT FROM v_owner AND "operation" = v_operation AND "key" = v_idemKey;
    IF v_existing."requestFingerprint" = v_fingerprint THEN
      RETURN v_existing."resultTransactionId";  -- replay (deferred completeness guaranteed non-null)
    ELSE
      RAISE EXCEPTION 'ledger_post: idempotency conflict — same key, different payload'
        USING ERRCODE = 'LG020';
    END IF;
  END IF;

  -- 5. Insert the immutable transaction header + legs.
  INSERT INTO public."LedgerTransaction"
    ("id", "operation", "ownerTenantId", "currency", "effectiveAt", "correlationId", "sourceType", "sourceRef", "actorId", "reversalOfId", "createdAt")
  VALUES (uuidv7(), v_operation, v_owner, v_currency, v_effective, v_correlation, v_sourceType, v_sourceRef, v_actor, v_reversalOf, now())
  RETURNING "id" INTO v_txn;

  INSERT INTO public."LedgerLeg" ("id", "transactionId", "accountId", "currency", "amountMicros", "createdAt")
  SELECT uuidv7(), v_txn, (l->>'accountId')::uuid, v_currency, (l->>'amountMicros')::bigint, now()
    FROM jsonb_array_elements(v_legs) AS l;

  -- 6. Finalize the idempotency linkage (claim → complete).
  UPDATE public."IdempotencyKey" SET "resultTransactionId" = v_txn
   WHERE "tenantId" IS NOT DISTINCT FROM v_owner AND "operation" = v_operation AND "key" = v_idemKey;

  -- 7. Deferred constraint triggers assert Σ=0, >=2 legs, currency, ownership and
  --    idempotency completeness at COMMIT. Return the new transaction id.
  RETURN v_txn;
END
$fn$;

-- ======================= PART C — roles, ownership, grants ====================
-- Runs as telvyn_migrator (owner of the tables + billing schema). Requires the
-- pre-migration admin grants (fn membership WITH SET; CREATE ON DATABASE).

-- C1. Least-privilege DML for the function owner (telvyn_ledger_fn). It performs
--     the ledger_post writes under SECURITY DEFINER and runs the triggers. NO
--     UPDATE/DELETE on the immutable transaction/leg tables; UPDATE on
--     IdempotencyKey is only the claim→complete finalize (the guard enforces it).
--     NOTE: USAGE ON SCHEMA public for telvyn_ledger_fn is a persistent ROLE
--     privilege granted by the admin bootstrap (ledger-dev-bootstrap.sql /
--     ci-bootstrap-roles.sql), NOT here — telvyn_migrator does not own schema
--     public and cannot grant USAGE on it (the grant would be a silent no-op).
GRANT SELECT ON "LedgerAccount" TO telvyn_ledger_fn;
GRANT SELECT, INSERT ON "LedgerTransaction" TO telvyn_ledger_fn;
GRANT SELECT, INSERT ON "LedgerLeg" TO telvyn_ledger_fn;
GRANT SELECT, INSERT, UPDATE ON "IdempotencyKey" TO telvyn_ledger_fn;

-- C2. Function ACL (manage while migrator still owns it; grants persist across the
--     ownership change). Runtime executes the function only — no table DML.
REVOKE EXECUTE ON FUNCTION "billing"."ledger_post"(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "billing"."ledger_post"(jsonb) TO telvyn_app;
GRANT USAGE ON SCHEMA "billing" TO telvyn_app;

-- C3. Ownership transfer of the SECURITY DEFINER function to the dedicated,
--     NOLOGIN, non-superuser owner (R6/§17/§20). The new owner needs persistent
--     USAGE and temporary CREATE on the schema to receive ownership; CREATE is
--     revoked immediately after (ownership persists). telvyn_migrator must be a
--     member of telvyn_ledger_fn WITH SET (the pre-migration admin grant).
GRANT USAGE ON SCHEMA "billing" TO telvyn_ledger_fn;
GRANT CREATE ON SCHEMA "billing" TO telvyn_ledger_fn;
ALTER FUNCTION "billing"."ledger_post"(jsonb) OWNER TO telvyn_ledger_fn;
REVOKE CREATE ON SCHEMA "billing" FROM telvyn_ledger_fn;
