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

\echo 'PRIV_CHECK_OK: restricted runtime-role privilege verification passed.'
