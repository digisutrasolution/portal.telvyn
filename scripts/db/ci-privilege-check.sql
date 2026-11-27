-- =============================================================================
-- Telvyn - restricted runtime-role privilege verification (Slice 13-1A.7A).
--
-- RUN AS: telvyn_app (the restricted application runtime role), against the
-- ephemeral CI (or isolated) database AFTER migrations + runtime grants.
--
-- Fails closed (psql ON_ERROR_STOP -> non-zero exit -> CI fails) if the runtime
-- role is over-privileged. Negative checks assert the EXACT privilege SQLSTATE
-- (42501 insufficient_privilege); a different error class (e.g. 42P01 undefined
-- object) or an unexpected success is a FAILURE - a missing object or syntax
-- error is never accepted as proof of a denied privilege.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

-- ---- Positive: identity + a permitted read -------------------------------
DO $$
BEGIN
  IF current_user <> 'telvyn_app' THEN
    RAISE EXCEPTION 'PRIV_FAIL: connected as % (expected telvyn_app)', current_user;
  END IF;
  PERFORM 1 FROM "Permission" LIMIT 1;  -- permitted SELECT
END
$$;

-- ---- Catalog: runtime role attributes + ownership ------------------------
DO $$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication
    INTO r FROM pg_roles WHERE rolname = 'telvyn_app';
  IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication THEN
    RAISE EXCEPTION 'PRIV_FAIL: telvyn_app has an elevated role attribute';
  END IF;
  IF has_schema_privilege('telvyn_app','public','CREATE') THEN
    RAISE EXCEPTION 'PRIV_FAIL: telvyn_app has CREATE on schema public';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner='telvyn_app') THEN
    RAISE EXCEPTION 'PRIV_FAIL: telvyn_app owns application tables';
  END IF;
  IF has_table_privilege('telvyn_app','public."_prisma_migrations"','SELECT') THEN
    RAISE EXCEPTION 'PRIV_FAIL: telvyn_app can read _prisma_migrations';
  END IF;
  -- Function-owner role must remain NOLOGIN, non-super, un-privileged this slice.
  SELECT rolcanlogin, rolsuper INTO r FROM pg_roles WHERE rolname = 'telvyn_ledger_fn';
  IF r.rolcanlogin OR r.rolsuper THEN
    RAISE EXCEPTION 'PRIV_FAIL: telvyn_ledger_fn is not NOLOGIN/non-superuser';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner='telvyn_ledger_fn') THEN
    RAISE EXCEPTION 'PRIV_FAIL: telvyn_ledger_fn owns tables';
  END IF;
  -- No managed-role memberships (no SET ROLE escalation path).
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles c ON c.oid=m.member
    WHERE c.rolname IN ('telvyn_migrator','telvyn_app','telvyn_ledger_fn')
  ) THEN
    RAISE EXCEPTION 'PRIV_FAIL: a managed role holds a role membership';
  END IF;

  -- Ledger (Phase 13-1B+C): runtime may EXECUTE the posting function and NOTHING
  -- else on the ledger. PUBLIC must not execute it. (Guarded so this check is a
  -- no-op before the ledger migration exists.)
  IF to_regprocedure('billing.ledger_post(jsonb)') IS NOT NULL THEN
    IF NOT has_function_privilege('telvyn_app','billing.ledger_post(jsonb)','EXECUTE') THEN
      RAISE EXCEPTION 'PRIV_FAIL: telvyn_app lacks EXECUTE on billing.ledger_post';
    END IF;
    IF has_function_privilege('public','billing.ledger_post(jsonb)','EXECUTE') THEN
      RAISE EXCEPTION 'PRIV_FAIL: PUBLIC has EXECUTE on billing.ledger_post';
    END IF;
    IF has_table_privilege('telvyn_app','public."LedgerLeg"','INSERT')
       OR has_table_privilege('telvyn_app','public."LedgerTransaction"','SELECT')
       OR has_table_privilege('telvyn_app','public."IdempotencyKey"','UPDATE') THEN
      RAISE EXCEPTION 'PRIV_FAIL: telvyn_app has a direct privilege on a ledger table';
    END IF;
  END IF;
END
$$;

-- ---- Negative: each forbidden op MUST fail with 42501 --------------------
-- Helper: run `stmt`; FAIL if it succeeds or errors with a non-privilege class.
DO $$
DECLARE
  stmt text;
  forbidden text[] := ARRAY[
    'CREATE TABLE public._priv_probe(x int)',
    'UPDATE "AuditLog" SET "action" = ''x'' WHERE false',
    'DELETE FROM "FraudEvent" WHERE false',
    'SELECT 1 FROM "_prisma_migrations" WHERE false',
    'TRUNCATE TABLE "Permission"',
    'ALTER TABLE "Permission" ADD COLUMN _probe int',
    'ALTER TABLE "Permission" DISABLE TRIGGER ALL',
    'DROP TABLE "Permission"',
    'CREATE ROLE _priv_probe_role LOGIN',
    -- (CREATE DATABASE cannot run inside a transaction block, so it cannot be
    --  exercised here; telvyn_app's NOCREATEDB is asserted via pg_roles above.)
    'SET ROLE telvyn_migrator',
    'SET ROLE telvyn_ledger_fn',
    'SET ROLE telvyn'
  ];
BEGIN
  FOREACH stmt IN ARRAY forbidden LOOP
    BEGIN
      EXECUTE stmt;
      RAISE EXCEPTION 'PRIV_FAIL: runtime role unexpectedly ALLOWED: %', stmt;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;  -- 42501: the expected denial
      WHEN undefined_object OR undefined_table OR undefined_function OR syntax_error THEN
        RAISE EXCEPTION 'PRIV_FAIL: % errored with a NON-privilege class % (not a valid denial)', stmt, SQLSTATE;
    END;
    -- (a privilege-adjacent class other than 42501 re-raises and fails via ON_ERROR_STOP)
  END LOOP;
END
$$;

-- ---- Ledger-specific runtime negatives (Phase 13-1B+C) ------------------
-- Guarded: a no-op before the ledger migration. Each forbidden op MUST fail with
-- 42501 (permission is checked before any constraint/trigger), proving the runtime
-- role has NO direct access to the financial ledger — only EXECUTE ledger_post.
DO $$
DECLARE
  stmt text;
  forbidden text[] := ARRAY[
    'SELECT 1 FROM "LedgerTransaction"',
    'INSERT INTO "LedgerLeg"("id","transactionId","accountId","currency","amountMicros") VALUES (uuidv7(),uuidv7(),uuidv7(),''USD'',1)',
    'UPDATE "LedgerLeg" SET "amountMicros"=1 WHERE false',
    'DELETE FROM "LedgerTransaction" WHERE false',
    'TRUNCATE TABLE "LedgerLeg"',
    'ALTER TABLE "LedgerTransaction" DISABLE TRIGGER ALL',
    'DROP FUNCTION billing.ledger_post(jsonb)'
  ];
BEGIN
  IF to_regprocedure('billing.ledger_post(jsonb)') IS NULL THEN
    RETURN;  -- ledger not migrated yet; nothing to probe
  END IF;
  FOREACH stmt IN ARRAY forbidden LOOP
    BEGIN
      EXECUTE stmt;
      RAISE EXCEPTION 'PRIV_FAIL: runtime role unexpectedly ALLOWED on ledger: %', stmt;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;  -- 42501: the expected denial
      WHEN undefined_object OR undefined_table OR undefined_function OR syntax_error THEN
        RAISE EXCEPTION 'PRIV_FAIL: ledger op % errored with a NON-privilege class % (not a valid denial)', stmt, SQLSTATE;
    END;
  END LOOP;
END
$$;

-- ---- BillingAccount runtime negatives (Phase 13-2B S3) -------------------
-- Owner decision E: in S3 the runtime role holds NO privilege on BillingAccount
-- (inert foundation). Every op MUST fail with 42501 — never a missing-object or
-- syntax error. S5 (SELECT+INSERT), S6 (column UPDATE) and S8 (reads) will
-- narrow this list; DELETE stays forbidden permanently (BA-13).
DO $$
DECLARE
  stmt text;
  forbidden text[] := ARRAY[
    'SELECT 1 FROM "BillingAccount" WHERE false',
    'INSERT INTO "BillingAccount"("tenantId","accountNumber","label","currency","mode","provisioningKey","provisioningFingerprint","updatedAt") VALUES (uuidv7(),''x'',''x'',''USD'',''PREPAID'',''x'',''x'',now())',
    'UPDATE "BillingAccount" SET "label" = ''x'' WHERE false',
    'UPDATE "BillingAccount" SET "currency" = ''EUR'' WHERE false',
    'DELETE FROM "BillingAccount" WHERE false',
    'TRUNCATE TABLE "BillingAccount"',
    'ALTER TABLE "BillingAccount" DISABLE TRIGGER ALL',
    'DROP FUNCTION billing.billing_account_guard()'
  ];
BEGIN
  IF to_regclass('public."BillingAccount"') IS NULL THEN
    RAISE EXCEPTION 'PRIV_FAIL: BillingAccount missing (S3 migration not applied)';
  END IF;
  FOREACH stmt IN ARRAY forbidden LOOP
    BEGIN
      EXECUTE stmt;
      RAISE EXCEPTION 'PRIV_FAIL: runtime role unexpectedly ALLOWED on BillingAccount: %', stmt;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;  -- 42501: the expected denial
      WHEN undefined_object OR undefined_table OR undefined_function OR syntax_error THEN
        RAISE EXCEPTION 'PRIV_FAIL: BillingAccount op % errored with a NON-privilege class % (not a valid denial)', stmt, SQLSTATE;
    END;
  END LOOP;
END
$$;

-- ---- StepUpGrant runtime negatives (Phase 13-2B S1) ----------------------
-- Owner decision G2: runtime holds SELECT, INSERT and UPDATE("consumedAt") only.
-- Every op below MUST fail with 42501 — never a missing-object or syntax error.
DO $$
DECLARE
  stmt text;
  forbidden text[] := ARRAY[
    'UPDATE "StepUpGrant" SET "expiresAt" = now() WHERE false',
    'UPDATE "StepUpGrant" SET "purpose" = ''x'' WHERE false',
    'UPDATE "StepUpGrant" SET "userId" = uuidv7() WHERE false',
    'UPDATE "StepUpGrant" SET "tenantId" = uuidv7() WHERE false',
    'DELETE FROM "StepUpGrant" WHERE false',
    'TRUNCATE TABLE "StepUpGrant"',
    'ALTER TABLE "StepUpGrant" DISABLE TRIGGER ALL',
    'DROP FUNCTION billing.step_up_grant_guard()'
  ];
BEGIN
  IF to_regclass('public."StepUpGrant"') IS NULL THEN
    RAISE EXCEPTION 'PRIV_FAIL: StepUpGrant missing (S1 migration not applied)';
  END IF;
  FOREACH stmt IN ARRAY forbidden LOOP
    BEGIN
      EXECUTE stmt;
      RAISE EXCEPTION 'PRIV_FAIL: runtime role unexpectedly ALLOWED on StepUpGrant: %', stmt;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;  -- 42501: the expected denial
      WHEN undefined_object OR undefined_table OR undefined_function OR syntax_error THEN
        RAISE EXCEPTION 'PRIV_FAIL: StepUpGrant op % errored with a NON-privilege class % (not a valid denial)', stmt, SQLSTATE;
    END;
  END LOOP;
END
$$;

-- ---- FinancialAuditEvent runtime negatives (Phase 13-2B S2) --------------
-- Owner decision F6 / S5 O7: runtime holds INSERT only (append-only audit).
-- Every op below MUST fail with 42501 - never a missing-object or syntax error.
DO $$
DECLARE
  stmt text;
  forbidden text[] := ARRAY[
    'UPDATE "FinancialAuditEvent" SET "reasonCode" = ''X_Y_Z'' WHERE false',
    'UPDATE "FinancialAuditEvent" SET "tenantId" = uuidv7() WHERE false',
    'DELETE FROM "FinancialAuditEvent" WHERE false',
    'TRUNCATE TABLE "FinancialAuditEvent"',
    'ALTER TABLE "FinancialAuditEvent" DISABLE TRIGGER ALL',
    'ALTER TABLE "FinancialAuditEvent" DROP CONSTRAINT "FinancialAuditEvent_reason_code_format_chk"',
    'DROP FUNCTION billing.financial_audit_event_guard()',
    'DROP FUNCTION billing.financial_audit_json_ok(jsonb)'
  ];
BEGIN
  IF to_regclass('public."FinancialAuditEvent"') IS NULL THEN
    RAISE EXCEPTION 'PRIV_FAIL: FinancialAuditEvent missing (S2 migration not applied)';
  END IF;
  FOREACH stmt IN ARRAY forbidden LOOP
    BEGIN
      EXECUTE stmt;
      RAISE EXCEPTION 'PRIV_FAIL: runtime role unexpectedly ALLOWED on FinancialAuditEvent: %', stmt;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;  -- 42501: the expected denial
      WHEN undefined_object OR undefined_table OR undefined_function OR syntax_error THEN
        RAISE EXCEPTION 'PRIV_FAIL: FinancialAuditEvent op % errored with a NON-privilege class % (not a valid denial)', stmt, SQLSTATE;
    END;
  END LOOP;
END
$$;

-- ---- Chart of Accounts runtime negatives (Phase 13-2B S4) ---------------
-- Owner decision D5: S4 is INERT - the runtime role may NOT execute the
-- account-opening function and has no direct LedgerAccount write. Each op MUST
-- fail with 42501 - never a missing-object or syntax error.
DO $$
DECLARE
  stmt text;
  forbidden text[] := ARRAY[
    'SELECT billing.ledger_account_open(uuidv7(), uuidv7(), ''USD''::"Currency", ''customer_funds'')',
    'INSERT INTO "LedgerAccount"("tenantId","currency","code","name","type","normalBalance","billingAccountId") VALUES (uuidv7(),''USD'',''customer_funds:x'',''x'',''LIABILITY'',''CREDIT'',uuidv7())',
    'UPDATE "LedgerAccount" SET "billingAccountId" = uuidv7() WHERE false',
    'ALTER TABLE "LedgerAccount" DISABLE TRIGGER ledger_account_link_guard',
    'ALTER TABLE "LedgerAccount" DROP CONSTRAINT "LedgerAccount_billing_link_tenant_chk"',
    'DROP FUNCTION billing.ledger_account_open(uuid, uuid, "Currency", text)',
    'DROP FUNCTION billing.ledger_account_link_guard()'
  ];
BEGIN
  IF to_regprocedure('billing.ledger_account_open(uuid,uuid,"Currency",text)') IS NULL THEN
    RAISE EXCEPTION 'PRIV_FAIL: billing.ledger_account_open missing (S4 migration not applied)';
  END IF;
  FOREACH stmt IN ARRAY forbidden LOOP
    BEGIN
      EXECUTE stmt;
      RAISE EXCEPTION 'PRIV_FAIL: runtime role unexpectedly ALLOWED on chart of accounts: %', stmt;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;  -- 42501: the expected denial
      WHEN undefined_object OR undefined_table OR undefined_function OR syntax_error THEN
        RAISE EXCEPTION 'PRIV_FAIL: chart-of-accounts op % errored with a NON-privilege class % (not a valid denial)', stmt, SQLSTATE;
    END;
  END LOOP;
END
$$;

-- ---- BillingAccount provisioning runtime negatives (Phase 13-2B S5) ------
-- O7: runtime has NO SELECT on FinancialAuditEvent (INSERT only). The runtime
-- role still has NO direct BillingAccount privilege and may NOT execute the
-- completeness/guard functions or ledger_account_open: the only provisioning
-- path is billing.billing_account_provision, which re-checks platform, MFA,
-- explicit permission and a step-up grant consumed in the same transaction.
DO $$
DECLARE
  stmt text;
  forbidden text[] := ARRAY[
    'SELECT 1 FROM "FinancialAuditEvent" LIMIT 1',
    'SELECT "id" FROM "FinancialAuditEvent" LIMIT 1',
    'SELECT 1 FROM "BillingAccount" LIMIT 1',
    'INSERT INTO "BillingAccount"("tenantId","accountNumber","currency","mode","label","provisioningKey","provisioningFingerprint","updatedAt") VALUES (uuidv7(),''BA-2026-222222222222'',''USD'',''PREPAID'',''x'',''aaaaaaaaaaaaaaaa'',''v1:'' || repeat(''0'',64),now())',
    'UPDATE "BillingAccount" SET "label" = ''x'' WHERE false',
    'DELETE FROM "BillingAccount" WHERE false',
    'ALTER TABLE "BillingAccount" DISABLE TRIGGER billing_account_provision_complete',
    'DROP FUNCTION billing.billing_account_provision_complete()',
    'DROP FUNCTION billing.billing_account_provisioning_guard()'
  ];
BEGIN
  IF to_regprocedure('billing.billing_account_provision(uuid,uuid,uuid,uuid,"Currency",text,boolean,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'PRIV_FAIL: billing.billing_account_provision missing (S5 migration not applied)';
  END IF;
  IF NOT has_function_privilege(current_user, 'billing.billing_account_provision(uuid,uuid,uuid,uuid,"Currency",text,boolean,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PRIV_FAIL: runtime role must EXECUTE billing.billing_account_provision';
  END IF;
  IF has_function_privilege(current_user, 'billing.billing_account_provision_complete()', 'EXECUTE')
     OR has_function_privilege(current_user, 'billing.billing_account_provisioning_guard()', 'EXECUTE')
     OR has_function_privilege(current_user, 'billing.ledger_account_open(uuid,uuid,"Currency",text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PRIV_FAIL: runtime role must not execute provisioning internals or ledger_account_open';
  END IF;
  FOREACH stmt IN ARRAY forbidden LOOP
    BEGIN
      EXECUTE stmt;
      RAISE EXCEPTION 'PRIV_FAIL: runtime role unexpectedly ALLOWED on provisioning surface: %', stmt;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;  -- 42501: the expected denial
      WHEN undefined_object OR undefined_table OR undefined_function OR undefined_column OR syntax_error THEN
        RAISE EXCEPTION 'PRIV_FAIL: provisioning op % errored with a NON-privilege class % (not a valid denial)', stmt, SQLSTATE;
    END;
  END LOOP;
END
$$;

\echo 'PRIV_CHECK_OK: restricted runtime-role privilege verification passed.'
