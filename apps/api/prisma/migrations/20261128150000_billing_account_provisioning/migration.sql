-- =============================================================================
-- Phase 13-2B, Slice S5 — governed BillingAccount provisioning (PREPAID only).
-- Implements ADR-0022 Amendment 5 BA-03 / BA-08 / BA-14 / BA-15 with owner
-- decisions O1–O7 (2026-11-28).
--
-- Design (why a function, not a table grant): the runtime role (telvyn_app) gets
-- NO privilege on BillingAccount at all. Instead it may EXECUTE one SECURITY
-- DEFINER function, billing.billing_account_provision, which re-verifies on the
-- database — independently of the application — that:
--   * the actor is an ACTIVE, MFA-enabled user with an ACTIVE membership of an
--     ACTIVE PLATFORM tenant (BP001);
--   * that membership holds `billing.account.provision` through a live role
--     (explicit grant only — the key is wildcard-excluded, so no "*" row ever
--     carries it) (BP002);
--   * a step-up grant for purpose billing_account.provision, bound to this actor
--     and actor tenant, was consumed by THIS transaction (BP003);
--   * the target tenant is an ACTIVE CUSTOMER or RESELLER tenant (BP004);
--   * every argument is well formed (BP005);
-- and then replays (same tenant + key + fingerprint + actor), refuses (BP006 key
-- reused for a different request) or creates the account with a server-built
-- number and opens its customer_funds ledger account in the same transaction.
-- A direct runtime INSERT grant was rejected: it would let any runtime-role
-- caller create accounts without platform authority, permission, step-up,
-- account-number rules or a ledger account (owner safeguard, S5).
--
-- A DEFERRED constraint trigger (BP010) refuses COMMIT of any account created by
-- this function unless its customer_funds ledger account AND an ALLOWED
-- billing_account.provision financial audit event by the same actor exist —
-- account + ledger account + audit are atomic, enforced by the database.
--
-- Custom SQLSTATEs (class BP — billing account provisioning):
--   BP001 platform authority required (actor/tenant/membership/MFA)
--   BP002 explicit permission billing.account.provision required
--   BP003 a step-up grant consumed in this transaction is required
--   BP004 target tenant is not an active CUSTOMER/RESELLER tenant
--   BP005 invalid argument
--   BP006 idempotency key already used for a different request
--   BP007 account number collision (the caller retries with a new suffix, bounded)
--   BP008 conflicts with an existing open account (label / default per currency)
--   BP010 provisioned account committed without its ledger account / audit event
--   BA001 (existing class) provisionedByUserId is immutable
--
-- Also in this migration:
--   * account-number / idempotency-key / fingerprint format CHECKs (O3/O5),
--     NOT VALID — existing rows are preserved, every new row is checked;
--   * FinancialAuditEvent: runtime SELECT revoked (O7 — the writer inserts
--     without RETURNING); no network data in new rows (O6, NOT VALID CHECK).
--
-- No money movement, no opening balance, no ledger posting, no POSTPAID.
-- Runs as telvyn_migrator inside the standard migration window
-- (scripts/db/ledger-migration-pre.sql grants SET membership in
-- telvyn_ledger_fn for the ownership transfer; ledger-migration-post.sql
-- revokes it).
-- =============================================================================

-- ======================= PART A — Prisma-managed DDL =========================
-- AlterTable
ALTER TABLE "BillingAccount" ADD COLUMN     "provisionedByUserId" UUID;

-- CreateIndex
CREATE INDEX "BillingAccount_provisionedByUserId_idx" ON "BillingAccount"("provisionedByUserId");

-- AddForeignKey
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_provisionedByUserId_fkey" FOREIGN KEY ("provisionedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ===================== PART B — raw provisioning integrity SQL ================
-- Verified by scripts/db/ledger-drift-check.sql (Prisma schema-diff cannot see it).

-- B1. Formats (O3 / O5). NOT VALID: rows created before S5 keep their values
--     (owner: preserve existing numbers); every INSERT/UPDATE from now on is checked.
--     Account number: BA-<UTC year>-<12 symbols from 23456789ABCDEFGHJKMNPQRSTVWXYZ>.
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_account_number_format_chk"
  CHECK ("accountNumber" ~ '^BA-[0-9]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$') NOT VALID;
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_provisioning_key_format_chk"
  CHECK ("provisioningKey" ~ '^[A-Za-z0-9._:-]{16,128}$') NOT VALID;
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_provisioning_fingerprint_format_chk"
  CHECK ("provisioningFingerprint" ~ '^v1:[0-9a-f]{64}$') NOT VALID;

-- B2. Provisioning attribution is immutable (BA001). SECURITY INVOKER, hardened.
CREATE FUNCTION "billing"."billing_account_provisioning_guard"() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF NEW."provisionedByUserId" IS DISTINCT FROM OLD."provisionedByUserId" THEN
    RAISE EXCEPTION 'billing account provisioning attribution is immutable' USING ERRCODE = 'BA001';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER "billing_account_provisioning_guard" BEFORE UPDATE ON "BillingAccount"
  FOR EACH ROW EXECUTE FUNCTION "billing"."billing_account_provisioning_guard"();

-- B3. Atomic completeness (BP010): DEFERRED to COMMIT, for accounts created by the
--     provisioning function (provisionedByUserId set). SECURITY DEFINER (owner
--     telvyn_ledger_fn, below) so it can read FinancialAuditEvent, which the
--     runtime role cannot (O7). SET CONSTRAINTS ... IMMEDIATE only makes it fire
--     earlier (and fail); it cannot be skipped.
CREATE FUNCTION "billing"."billing_account_provision_complete"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN
  IF NEW."provisionedByUserId" IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."LedgerAccount" a
     WHERE a."billingAccountId" = NEW."id" AND split_part(a."code", ':', 1) = 'customer_funds'
  ) THEN
    RAISE EXCEPTION 'provisioned billing account has no customer_funds ledger account' USING ERRCODE = 'BP010';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."FinancialAuditEvent" e
     WHERE e."billingAccountId" = NEW."id"
       AND e."operation" = 'billing_account.provision'
       AND e."decision" = 'ALLOWED'
       AND e."actorUserId" = NEW."provisionedByUserId"
  ) THEN
    RAISE EXCEPTION 'provisioned billing account has no ALLOWED financial audit event' USING ERRCODE = 'BP010';
  END IF;
  RETURN NULL;
END
$fn$;
CREATE CONSTRAINT TRIGGER "billing_account_provision_complete" AFTER INSERT ON "BillingAccount"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "billing"."billing_account_provision_complete"();

-- B4. The provisioning function (SECURITY DEFINER, owner telvyn_ledger_fn, hardened
--     search_path, schema-qualified, no dynamic SQL).
--     Idempotency without advisory locks: the unique ("tenantId","provisioningKey")
--     index is the serialization point. INSERT ... ON CONFLICT DO NOTHING waits for
--     a concurrent in-flight insert of the same key and then does nothing; the
--     committed row is then re-read and replayed or refused. The key scope is the
--     target tenant; the actor and every parameter are bound by the fingerprint
--     and provisionedByUserId (a different actor reusing the key is BP006).
CREATE FUNCTION "billing"."billing_account_provision"(
    p_actor_user_id    uuid,
    p_actor_tenant_id  uuid,
    p_step_up_grant_id uuid,
    p_target_tenant_id uuid,
    p_currency         public."Currency",
    p_label            text,
    p_is_default       boolean,
    p_number_suffix    text,
    p_provisioning_key text,
    p_fingerprint      text)
  RETURNS TABLE (billing_account_id uuid, ledger_account_id uuid, account_number text, label text,
                 currency public."Currency", is_default boolean, created_at timestamptz, replayed boolean)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ex      record;
  v_id      uuid;
  v_created timestamptz;
  v_number  text;
  v_ledger  uuid;
BEGIN
  -- BP005 — arguments.
  IF p_actor_user_id IS NULL OR p_actor_tenant_id IS NULL OR p_step_up_grant_id IS NULL
     OR p_target_tenant_id IS NULL OR p_currency IS NULL OR p_label IS NULL OR p_is_default IS NULL
     OR p_number_suffix IS NULL OR p_provisioning_key IS NULL OR p_fingerprint IS NULL THEN
    RAISE EXCEPTION 'billing_account_provision: all arguments are required' USING ERRCODE = 'BP005';
  END IF;
  IF p_label <> btrim(p_label) OR p_label = '' OR char_length(p_label) > 100 OR p_label ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'billing_account_provision: invalid label' USING ERRCODE = 'BP005';
  END IF;
  IF p_number_suffix !~ '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$'
     OR p_provisioning_key !~ '^[A-Za-z0-9._:-]{16,128}$'
     OR p_fingerprint !~ '^v1:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'billing_account_provision: invalid number suffix, key or fingerprint' USING ERRCODE = 'BP005';
  END IF;

  -- BP001 — platform authority: active MFA user, active membership, active PLATFORM tenant.
  IF NOT EXISTS (
    SELECT 1
      FROM public."Tenant" t
      JOIN public."Membership" m ON m."tenantId" = t."id"
      JOIN public."User" u ON u."id" = m."userId"
     WHERE t."id" = p_actor_tenant_id AND t."type" = 'PLATFORM' AND t."status" = 'ACTIVE' AND t."deletedAt" IS NULL
       AND m."userId" = p_actor_user_id AND m."status" = 'ACTIVE' AND m."deletedAt" IS NULL
       AND u."status" = 'ACTIVE' AND u."deletedAt" IS NULL AND u."mfaEnabled"
  ) THEN
    RAISE EXCEPTION 'billing_account_provision: platform authority required' USING ERRCODE = 'BP001';
  END IF;

  -- BP002 — the explicit permission through a live role of that membership.
  IF NOT EXISTS (
    SELECT 1
      FROM public."Membership" m
      JOIN public."MembershipRole" mr ON mr."membershipId" = m."id"
      JOIN public."Role" r ON r."id" = mr."roleId" AND r."deletedAt" IS NULL
                          AND (r."tenantId" IS NULL OR r."tenantId" = m."tenantId")
      JOIN public."RolePermission" rp ON rp."roleId" = r."id"
      JOIN public."Permission" p ON p."id" = rp."permissionId"
     WHERE m."tenantId" = p_actor_tenant_id AND m."userId" = p_actor_user_id
       AND m."status" = 'ACTIVE' AND m."deletedAt" IS NULL
       AND p."key" = 'billing.account.provision'
  ) THEN
    RAISE EXCEPTION 'billing_account_provision: permission billing.account.provision required' USING ERRCODE = 'BP002';
  END IF;

  -- BP003 — the step-up grant was consumed by THIS transaction (StepUpService.consume
  -- stamps consumedAt = now() = transaction_timestamp()), for this purpose and actor.
  IF NOT EXISTS (
    SELECT 1 FROM public."StepUpGrant" g
     WHERE g."id" = p_step_up_grant_id
       AND g."userId" = p_actor_user_id
       AND g."tenantId" = p_actor_tenant_id
       AND g."purpose" = 'billing_account.provision'
       AND g."consumedAt" = transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'billing_account_provision: a step-up grant consumed in this transaction is required'
      USING ERRCODE = 'BP003';
  END IF;

  -- BP004 — target tenant.
  IF NOT EXISTS (
    SELECT 1 FROM public."Tenant" t
     WHERE t."id" = p_target_tenant_id AND t."type" IN ('CUSTOMER', 'RESELLER')
       AND t."status" = 'ACTIVE' AND t."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'billing_account_provision: target tenant is not an active CUSTOMER or RESELLER tenant'
      USING ERRCODE = 'BP004';
  END IF;

  -- Replay / reuse check (fast path).
  SELECT b."id", b."provisioningFingerprint", b."provisionedByUserId", b."accountNumber", b."label",
         b."currency", b."isDefault", b."createdAt"
    INTO v_ex
    FROM public."BillingAccount" b
   WHERE b."tenantId" = p_target_tenant_id AND b."provisioningKey" = p_provisioning_key;
  IF NOT FOUND THEN
    v_number := 'BA-' || to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY') || '-' || p_number_suffix;
    INSERT INTO public."BillingAccount"
      ("tenantId", "accountNumber", "label", "currency", "mode", "isDefault",
       "provisioningKey", "provisioningFingerprint", "provisionedByUserId", "updatedAt")
    VALUES (p_target_tenant_id, v_number, p_label, p_currency, 'PREPAID', p_is_default,
            p_provisioning_key, p_fingerprint, p_actor_user_id, transaction_timestamp())
    ON CONFLICT DO NOTHING
    RETURNING "id", "createdAt" INTO v_id, v_created;

    IF v_id IS NOT NULL THEN
      v_ledger := "billing"."ledger_account_open"(v_id, p_target_tenant_id, p_currency, 'customer_funds');
      RETURN QUERY SELECT v_id, v_ledger, v_number, p_label, p_currency, p_is_default, v_created, false;
      RETURN;
    END IF;

    -- Nothing inserted: classify the conflict (the same key may have just committed).
    SELECT b."id", b."provisioningFingerprint", b."provisionedByUserId", b."accountNumber", b."label",
           b."currency", b."isDefault", b."createdAt"
      INTO v_ex
      FROM public."BillingAccount" b
     WHERE b."tenantId" = p_target_tenant_id AND b."provisioningKey" = p_provisioning_key;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public."BillingAccount" b WHERE b."accountNumber" = v_number) THEN
        RAISE EXCEPTION 'billing_account_provision: account number collision' USING ERRCODE = 'BP007';
      END IF;
      RAISE EXCEPTION 'billing_account_provision: conflicts with an existing open account (label or default)'
        USING ERRCODE = 'BP008';
    END IF;
  END IF;

  -- The key exists: replay only the identical request by the same actor.
  IF v_ex."provisioningFingerprint" <> p_fingerprint
     OR v_ex."provisionedByUserId" IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'billing_account_provision: idempotency key already used for a different request'
      USING ERRCODE = 'BP006';
  END IF;
  SELECT a."id" INTO v_ledger
    FROM public."LedgerAccount" a
   WHERE a."billingAccountId" = v_ex."id" AND split_part(a."code", ':', 1) = 'customer_funds';
  RETURN QUERY SELECT v_ex."id", v_ledger, v_ex."accountNumber", v_ex."label", v_ex."currency",
                      v_ex."isDefault", v_ex."createdAt", true;
END
$fn$;


-- ======================= PART C — FinancialAuditEvent (O6 / O7) ==============
-- C1. O6: no client network data in immutable financial evidence. NOT VALID —
--     rows written before S5 are preserved unchanged (append-only); new rows only.
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_no_network_data_chk"
  CHECK ("ipAddress" IS NULL AND "userAgent" IS NULL) NOT VALID;
-- C2. O7: the runtime role appends only. The writer inserts without RETURNING and
--     allocates the id with uuidv7() first, so no SELECT is needed. No runtime
--     read path exists; audit reads arrive later through a restricted interface.
REVOKE SELECT ON "FinancialAuditEvent" FROM telvyn_app;


-- ======================= PART D — ownership and grants =======================
-- D1. Minimum function-owner privileges for telvyn_ledger_fn — read-only columns
--     for the authority checks, the exact BillingAccount insert columns, and the
--     audit columns the completeness trigger reads. Impact on the other
--     telvyn_ledger_fn functions (ledger_post, ledger_account_open): none — both
--     have fixed bodies without dynamic SQL that never touch these tables/columns.
GRANT SELECT ("id", "type", "status", "deletedAt") ON "Tenant" TO telvyn_ledger_fn;
GRANT SELECT ("id", "userId", "tenantId", "status", "deletedAt") ON "Membership" TO telvyn_ledger_fn;
GRANT SELECT ("id", "status", "deletedAt", "mfaEnabled") ON "User" TO telvyn_ledger_fn;
GRANT SELECT ("membershipId", "roleId") ON "MembershipRole" TO telvyn_ledger_fn;
GRANT SELECT ("id", "tenantId", "deletedAt") ON "Role" TO telvyn_ledger_fn;
GRANT SELECT ("roleId", "permissionId") ON "RolePermission" TO telvyn_ledger_fn;
GRANT SELECT ("id", "key") ON "Permission" TO telvyn_ledger_fn;
GRANT SELECT ("id", "userId", "tenantId", "purpose", "consumedAt") ON "StepUpGrant" TO telvyn_ledger_fn;
GRANT SELECT ("billingAccountId", "operation", "decision", "actorUserId") ON "FinancialAuditEvent" TO telvyn_ledger_fn;
GRANT INSERT ("tenantId", "accountNumber", "label", "currency", "mode", "isDefault",
              "provisioningKey", "provisioningFingerprint", "provisionedByUserId", "updatedAt")
  ON "BillingAccount" TO telvyn_ledger_fn;
GRANT SELECT ("label", "isDefault", "provisioningKey", "provisioningFingerprint", "provisionedByUserId", "createdAt")
  ON "BillingAccount" TO telvyn_ledger_fn;

-- D2. Function ACLs: nothing for PUBLIC.
REVOKE EXECUTE ON FUNCTION "billing"."billing_account_provision"(uuid, uuid, uuid, uuid, public."Currency", text, boolean, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "billing"."billing_account_provision_complete"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "billing"."billing_account_provisioning_guard"() FROM PUBLIC;

-- D3. Ownership transfer of the two SECURITY DEFINER functions to the NOLOGIN
--     function owner (same lifecycle as ledger_post / ledger_account_open).
GRANT CREATE ON SCHEMA "billing" TO telvyn_ledger_fn;
ALTER FUNCTION "billing"."billing_account_provision"(uuid, uuid, uuid, uuid, public."Currency", text, boolean, text, text, text) OWNER TO telvyn_ledger_fn;
ALTER FUNCTION "billing"."billing_account_provision_complete"() OWNER TO telvyn_ledger_fn;
REVOKE CREATE ON SCHEMA "billing" FROM telvyn_ledger_fn;

-- D4. Runtime EXECUTE on the provisioning function ONLY, issued by the new owner
--     (after the transfer — see the S4 ACL note: a grant made while the migrator
--     owns the function is rewritten by ALTER ... OWNER). telvyn_migrator holds SET
--     (not INHERIT) membership in telvyn_ledger_fn only during the migration
--     window. Resulting ACL: {telvyn_ledger_fn (owner), telvyn_app} — drift-checked.
--     ledger_account_open keeps NO runtime EXECUTE: it is reachable only through
--     billing_account_provision.
SET LOCAL ROLE telvyn_ledger_fn;
GRANT EXECUTE ON FUNCTION "billing"."billing_account_provision"(uuid, uuid, uuid, uuid, public."Currency", text, boolean, text, text, text) TO telvyn_app;
RESET ROLE;
