-- =============================================================================
-- Phase 13-2B, Slice S4 — Chart of Accounts foundation (INERT).
-- Implements ADR-0022 Amendment 5 BA-10 (with BA-03/BA-04) and owner decisions
-- D1–D6 (2026-11-28). Additive only: one nullable column, one unique index, one
-- composite FK, three CHECKs, one partial expression unique index, one guard
-- trigger and one restricted SECURITY DEFINER function. No existing object is
-- altered or dropped; no historical migration is rewritten.
--
-- D1  Exactly ONE taxonomy: `customer_funds` = LIABILITY / normal balance CREDIT,
--     for PREPAID BillingAccounts only; code = 'customer_funds:' || accountNumber.
--     It represents customer funds held by the platform. The ledger sign
--     convention is unchanged (debit positive, credit negative); this is NOT the
--     customer-facing wallet balance and NOT the complete commercial chart of
--     accounts (platform cash / clearing / revenue / settlement accounts are
--     designed and accepted before their postings exist).
-- D2  No platform-owned account is created; existing (unlinked) accounts keep
--     working unchanged — the link column is NULL for them.
-- D3  Opening requires an existing, PREPAID, ACTIVE BillingAccount of the given
--     tenant and currency, validated under a row lock (FOR UPDATE) so that a
--     concurrent status change cannot interleave. No lifecycle transition added.
-- D4  At most one account per (BillingAccount, taxonomy), enforced by a unique
--     index; duplicates fail with the stable SQLSTATE LA005. No ledger posting —
--     opening an account never creates a (zero-value) ledger transaction.
-- D5  billing.ledger_account_open: SECURITY DEFINER, owner telvyn_ledger_fn,
--     search_path pg_catalog, pg_temp, schema-qualified, no dynamic SQL, PUBLIC
--     EXECUTE revoked, NO runtime (telvyn_app) EXECUTE in S4 (granted in S5).
-- D6  Same-tenant + same-currency linkage by composite FK (RESTRICT/RESTRICT);
--     the cross-table code rule (code = taxonomy:accountNumber) is enforced by a
--     BEFORE INSERT trigger — a CHECK cannot compare across tables.
--
-- Custom SQLSTATEs (class LA — ledger account opening):
--   LA001 billing account not found for this tenant (also hides other tenants')
--   LA002 billing account is not PREPAID
--   LA003 billing account is not ACTIVE
--   LA004 currency does not match the billing account
--   LA005 a ledger account of this taxonomy already exists for the account
--   LA006 the BillingAccount link of a ledger account is immutable
--   LA007 taxonomy / code / type / normal balance not approved for a linked account
--   LA030 platform authority required in the session context
--   LA031 required argument missing
--
-- Runs as telvyn_migrator inside the standard migration window
-- (scripts/db/ledger-migration-pre.sql grants SET membership in telvyn_ledger_fn
-- for the ownership transfer; ledger-migration-post.sql revokes it).
-- =============================================================================

-- ======================= PART A — Prisma-managed DDL =========================
-- AlterTable
ALTER TABLE "LedgerAccount" ADD COLUMN     "billingAccountId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_id_tenantId_currency_key" ON "BillingAccount"("id", "tenantId", "currency");

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_billingAccountId_tenantId_currency_fkey" FOREIGN KEY ("billingAccountId", "tenantId", "currency") REFERENCES "BillingAccount"("id", "tenantId", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ===================== PART B — raw chart-of-accounts integrity SQL ===========
-- Verified by scripts/db/ledger-drift-check.sql (Prisma schema-diff cannot see it).

-- B1. A link requires a tenant owner. The composite FK is MATCH SIMPLE: with a
--     NULL tenantId it would not be checked at all, so a platform-owned (NULL
--     tenant) row must never carry a BillingAccount link.
ALTER TABLE "LedgerAccount"
  ADD CONSTRAINT "LedgerAccount_billing_link_tenant_chk"
  CHECK ("billingAccountId" IS NULL OR "tenantId" IS NOT NULL);

-- B2. Approved taxonomy shape for a linked account (same-row rule, D1/D6): the
--     code prefix is an approved taxonomy and its type / normal balance match.
ALTER TABLE "LedgerAccount"
  ADD CONSTRAINT "LedgerAccount_billing_link_taxonomy_chk"
  CHECK ("billingAccountId" IS NULL
         OR (starts_with("code", 'customer_funds:')
             AND "type" = 'LIABILITY' AND "normalBalance" = 'CREDIT'));

-- B3. The taxonomy prefix is reserved: an unlinked account can never use it, so
--     no `customer_funds:` account can exist outside a BillingAccount link.
ALTER TABLE "LedgerAccount"
  ADD CONSTRAINT "LedgerAccount_customer_funds_reserved_chk"
  CHECK ("billingAccountId" IS NOT NULL OR NOT starts_with("code", 'customer_funds:'));

-- B4. One account per (BillingAccount, taxonomy) (D4). Partial expression index:
--     unlinked accounts are not constrained by it; the taxonomy is the code prefix.
CREATE UNIQUE INDEX "LedgerAccount_billingAccountId_taxonomy_key"
  ON "LedgerAccount"("billingAccountId", split_part("code", ':', 1))
  WHERE "billingAccountId" IS NOT NULL;

-- B5. Link guard (D3/D6). SECURITY INVOKER, hardened search_path, schema-qualified.
--     Fires for every role (including the table owner):
--       INSERT with a link: the BillingAccount must exist for this tenant and
--         currency, be PREPAID and ACTIVE, and code must equal
--         'customer_funds:' || accountNumber (the cross-table rule).
--       UPDATE: the link is immutable (LA006). (ledger_account_guard keeps
--         enforcing LG011 for ownership/currency/type/normalBalance/code.)
CREATE FUNCTION "billing"."ledger_account_link_guard"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_ba record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."billingAccountId" IS DISTINCT FROM OLD."billingAccountId" THEN
      RAISE EXCEPTION 'the billing account link of a ledger account is immutable'
        USING ERRCODE = 'LA006';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW."billingAccountId" IS NULL THEN
    RETURN NEW;  -- unlinked (platform / pre-S4 style) account: unchanged behaviour
  END IF;
  SELECT b."tenantId", b."currency", b."mode", b."status", b."accountNumber"
    INTO v_ba
    FROM public."BillingAccount" b
   WHERE b."id" = NEW."billingAccountId";
  IF NOT FOUND OR v_ba."tenantId" IS DISTINCT FROM NEW."tenantId" THEN
    RAISE EXCEPTION 'billing account not found for this tenant' USING ERRCODE = 'LA001';
  END IF;
  IF v_ba."currency" <> NEW."currency" THEN
    RAISE EXCEPTION 'ledger account currency does not match the billing account'
      USING ERRCODE = 'LA004';
  END IF;
  IF v_ba."mode" <> 'PREPAID' THEN
    RAISE EXCEPTION 'billing account is not PREPAID' USING ERRCODE = 'LA002';
  END IF;
  IF v_ba."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'billing account is not ACTIVE' USING ERRCODE = 'LA003';
  END IF;
  IF NEW."code" <> 'customer_funds:' || v_ba."accountNumber"
     OR NEW."type" <> 'LIABILITY' OR NEW."normalBalance" <> 'CREDIT' THEN
    RAISE EXCEPTION 'ledger account taxonomy, code, type or normal balance is not approved'
      USING ERRCODE = 'LA007';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "ledger_account_link_guard" BEFORE INSERT OR UPDATE ON "LedgerAccount"
  FOR EACH ROW EXECUTE FUNCTION "billing"."ledger_account_link_guard"();

-- B6. The restricted account-opening function (BA-10, D3–D5). SECURITY DEFINER
--     (owner telvyn_ledger_fn, set below); hardened search_path; every object
--     schema-qualified; no dynamic SQL. Platform-only (BA-03 provisioning is a
--     platform action): requires app.is_platform = on in the trusted,
--     server-derived session context. Caller-supplied tenant and currency are
--     EXPECTATIONS that must match the locked BillingAccount — they never
--     authorize on their own. Inserts exactly one LedgerAccount and nothing else
--     (no ledger transaction, no leg, no idempotency row). The caller (S5) owns
--     authorization, provisioning idempotency (on the BillingAccount row) and
--     writes the financial audit event in the same transaction (BA-14).
CREATE FUNCTION "billing"."ledger_account_open"(
    p_billing_account_id uuid,
    p_tenant_id          uuid,
    p_currency           public."Currency",
    p_taxonomy           text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx_platform boolean := coalesce(current_setting('app.is_platform', true), 'off') = 'on';
  v_ba           record;
  v_id           uuid;
BEGIN
  IF NOT v_ctx_platform THEN
    RAISE EXCEPTION 'ledger_account_open: platform authority required in the session context'
      USING ERRCODE = 'LA030';
  END IF;
  IF p_billing_account_id IS NULL OR p_tenant_id IS NULL OR p_currency IS NULL
     OR p_taxonomy IS NULL THEN
    RAISE EXCEPTION 'ledger_account_open: billing account, tenant, currency and taxonomy are required'
      USING ERRCODE = 'LA031';
  END IF;
  IF p_taxonomy <> 'customer_funds' THEN
    RAISE EXCEPTION 'ledger_account_open: taxonomy is not approved' USING ERRCODE = 'LA007';
  END IF;

  -- Lock the BillingAccount row for the rest of the transaction: a concurrent
  -- status change (UPDATE) or a concurrent open of the same account waits, so
  -- the lifecycle checks below cannot be invalidated before COMMIT.
  SELECT b."tenantId", b."currency", b."mode", b."status", b."accountNumber"
    INTO v_ba
    FROM public."BillingAccount" b
   WHERE b."id" = p_billing_account_id
     FOR UPDATE;
  IF NOT FOUND OR v_ba."tenantId" <> p_tenant_id THEN
    RAISE EXCEPTION 'ledger_account_open: billing account not found for this tenant'
      USING ERRCODE = 'LA001';
  END IF;
  IF v_ba."currency" <> p_currency THEN
    RAISE EXCEPTION 'ledger_account_open: currency does not match the billing account'
      USING ERRCODE = 'LA004';
  END IF;
  IF v_ba."mode" <> 'PREPAID' THEN
    RAISE EXCEPTION 'ledger_account_open: billing account is not PREPAID' USING ERRCODE = 'LA002';
  END IF;
  IF v_ba."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'ledger_account_open: billing account is not ACTIVE' USING ERRCODE = 'LA003';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."LedgerAccount" a
     WHERE a."billingAccountId" = p_billing_account_id
       AND split_part(a."code", ':', 1) = p_taxonomy
  ) THEN
    RAISE EXCEPTION 'ledger_account_open: the account already exists' USING ERRCODE = 'LA005';
  END IF;

  BEGIN
    INSERT INTO public."LedgerAccount"
      ("tenantId", "currency", "code", "name", "type", "normalBalance", "billingAccountId")
    VALUES (p_tenant_id, p_currency, 'customer_funds:' || v_ba."accountNumber",
            'Customer funds ' || v_ba."accountNumber", 'LIABILITY', 'CREDIT', p_billing_account_id)
    RETURNING "id" INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Backstop for the database-level uniqueness (D4): same stable error.
    RAISE EXCEPTION 'ledger_account_open: the account already exists' USING ERRCODE = 'LA005';
  END;
  RETURN v_id;
END
$fn$;

-- ======================= PART C — ownership and grants =======================
-- C1. Minimum function-owner privileges (D5). telvyn_ledger_fn needs:
--     - INSERT on exactly the columns the function writes (id/status/createdAt
--       come from defaults; retiredAt is never written);
--     - SELECT on the BillingAccount columns it validates;
--     - a row lock (FOR UPDATE) on BillingAccount, which PostgreSQL only permits
--       with an UPDATE privilege on at least one column. The narrowest grant is
--       UPDATE("statusChangedAt"): billing_account_guard always overwrites that
--       column (OLD value unless status changes), so it confers no effective
--       write. No INSERT / DELETE / broader UPDATE on BillingAccount.
--     Impact on billing.ledger_post (the only other telvyn_ledger_fn function):
--     none — it has no dynamic SQL and its fixed body never inserts a
--     LedgerAccount or reads/locks BillingAccount, so these privileges are not
--     reachable through it.
GRANT INSERT ("tenantId", "currency", "code", "name", "type", "normalBalance", "billingAccountId")
  ON "LedgerAccount" TO telvyn_ledger_fn;
GRANT SELECT ("id", "tenantId", "currency", "mode", "status", "accountNumber")
  ON "BillingAccount" TO telvyn_ledger_fn;
GRANT UPDATE ("statusChangedAt") ON "BillingAccount" TO telvyn_ledger_fn;

-- C2. Function ACL: PUBLIC EXECUTE revoked; NO runtime EXECUTE in S4 (inert —
--     S5 grants it with the governed provisioning path).
--     telvyn_migrator keeps EXECUTE so the database invariants can be verified
--     through the real definer path (E2E fixture). This is privilege-neutral:
--     telvyn_migrator OWNS LedgerAccount and BillingAccount and can already write
--     them directly; the function (running as telvyn_ledger_fn) can do strictly
--     less, and every trigger/constraint applies to the owner too. Without this
--     explicit grant the ownership transfer below would drop the migrator's
--     implicit owner privilege.
REVOKE EXECUTE ON FUNCTION "billing"."ledger_account_open"(uuid, uuid, public."Currency", text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "billing"."ledger_account_open"(uuid, uuid, public."Currency", text) FROM telvyn_app;
GRANT EXECUTE ON FUNCTION "billing"."ledger_account_open"(uuid, uuid, public."Currency", text) TO telvyn_migrator;

-- C3. Ownership transfer to the NOLOGIN function owner (same lifecycle as
--     ledger_post): temporary CREATE on the schema, transfer, revoke CREATE.
GRANT CREATE ON SCHEMA "billing" TO telvyn_ledger_fn;
ALTER FUNCTION "billing"."ledger_account_open"(uuid, uuid, public."Currency", text) OWNER TO telvyn_ledger_fn;
REVOKE CREATE ON SCHEMA "billing" FROM telvyn_ledger_fn;
