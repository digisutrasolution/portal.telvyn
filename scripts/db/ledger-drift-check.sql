-- =============================================================================
-- Telvyn — Ledger Foundation schema + privilege DRIFT CHECK (Phase 13-1B+C).
-- Verifies the SEMANTICS (not just names) of the protected ledger objects and
-- fails closed (RAISE → non-zero exit under ON_ERROR_STOP) on any deviation.
-- Implements LF §19 / R6 / slice §24. Read-only (catalog inspection + privilege
-- probes); safe to run on any target after the ledger migration.
--
-- RUN AS: any role that can read the catalogs (the bootstrap admin in CI/dev).
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  v int; v2 int; v_txt text; v_bool boolean;
BEGIN
  -- ---- 1. Tables + key columns / NOT NULL / types -------------------------
  FOR v_txt IN SELECT unnest(ARRAY['LedgerAccount','LedgerTransaction','LedgerLeg','IdempotencyKey']) LOOP
    IF to_regclass('public.'||quote_ident(v_txt)) IS NULL THEN
      RAISE EXCEPTION 'DRIFT: table public.% missing', v_txt;
    END IF;
  END LOOP;

  -- amountMicros is BIGINT and NOT NULL
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='LedgerLeg' AND column_name='amountMicros'
     AND data_type='bigint' AND is_nullable='NO';
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: LedgerLeg.amountMicros must be NOT NULL bigint'; END IF;

  -- timestamptz on ledger timestamps
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='LedgerTransaction'
     AND column_name IN ('effectiveAt','createdAt') AND data_type='timestamp with time zone';
  IF v <> 2 THEN RAISE EXCEPTION 'DRIFT: LedgerTransaction timestamps must be timestamptz'; END IF;

  -- ---- 2. amount CHECK (non-zero + bounded) -------------------------------
  SELECT count(*) INTO v FROM pg_constraint
   WHERE conname='LedgerLeg_amountMicros_nonzero_bounded_chk' AND contype='c';
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: LedgerLeg amount CHECK constraint missing'; END IF;

  -- ---- 3. FKs are ON DELETE RESTRICT (no cascade of financial history) -----
  SELECT count(*) INTO v FROM pg_constraint
   WHERE contype='f' AND connamespace='public'::regnamespace
     AND conrelid IN ('public."LedgerAccount"'::regclass,'public."LedgerTransaction"'::regclass,
                      'public."LedgerLeg"'::regclass,'public."IdempotencyKey"'::regclass)
     AND confdeltype <> 'r';
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: % ledger FK(s) are not ON DELETE RESTRICT', v; END IF;

  -- composite FK (accountId,currency) → LedgerAccount(id,currency)
  SELECT count(*) INTO v FROM pg_constraint
   WHERE conname='LedgerLeg_accountId_currency_fkey' AND contype='f'
     AND array_length(conkey,1)=2;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: composite currency FK on LedgerLeg missing'; END IF;

  -- ---- 4. NULLS NOT DISTINCT unique indexes -------------------------------
  SELECT bool_and(ix.indnullsnotdistinct) INTO v_bool
    FROM pg_index ix JOIN pg_class c ON c.oid=ix.indexrelid
   WHERE c.relname IN ('LedgerAccount_tenantId_currency_code_key','IdempotencyKey_tenantId_operation_key_key');
  IF v_bool IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'DRIFT: natural-identity unique indexes must be NULLS NOT DISTINCT';
  END IF;
  -- resultTransactionId is UNIQUE
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='IdempotencyKey_resultTransactionId_key') THEN
    RAISE EXCEPTION 'DRIFT: IdempotencyKey.resultTransactionId unique index missing';
  END IF;

  -- ---- 5. Deferred constraint triggers (deferrable + initially deferred + enabled)
  SELECT count(*) INTO v FROM pg_trigger
   WHERE tgname IN ('ledger_tx_validate','idempotency_complete')
     AND tgdeferrable AND tginitdeferred AND tgenabled='O';
  IF v <> 2 THEN RAISE EXCEPTION 'DRIFT: deferred balancing/completeness triggers missing or not deferred/enabled'; END IF;

  -- ---- 6. Immutability + guard triggers present and ENABLED ---------------
  SELECT count(*) INTO v FROM pg_trigger
   WHERE tgname IN ('ledger_tx_immutable','ledger_leg_immutable','ledger_leg_insert_guard',
                    'ledger_account_guard','idempotency_guard')
     AND tgenabled='O';
  IF v <> 5 THEN RAISE EXCEPTION 'DRIFT: immutability/guard triggers missing or not enabled (found %)', v; END IF;

  -- ---- 7. billing.ledger_post: SECURITY DEFINER, owner, search_path -------
  SELECT count(*) INTO v FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_roles r ON r.oid=p.proowner
   WHERE n.nspname='billing' AND p.proname='ledger_post'
     AND p.prosecdef
     AND r.rolname='telvyn_ledger_fn'
     AND 'search_path=pg_catalog, pg_temp' = ANY(p.proconfig);
  IF v <> 1 THEN
    RAISE EXCEPTION 'DRIFT: billing.ledger_post must be SECURITY DEFINER, owned by telvyn_ledger_fn, hardened search_path';
  END IF;

  -- ---- 8. Function owner role hardening ------------------------------------
  SELECT count(*) INTO v FROM pg_roles
   WHERE rolname='telvyn_ledger_fn'
     AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
     AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: telvyn_ledger_fn must be NOLOGIN/non-super/no-bypassrls/no-create'; END IF;

  -- function owner must not OWN any ledger table (only the function)
  SELECT count(*) INTO v FROM pg_tables
   WHERE schemaname='public' AND tableowner='telvyn_ledger_fn';
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: telvyn_ledger_fn must not own tables'; END IF;

  -- ---- 9. Function ACL: PUBLIC EXECUTE revoked; runtime EXECUTE present ----
  IF has_function_privilege('public','billing.ledger_post(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'DRIFT: PUBLIC must not have EXECUTE on billing.ledger_post';
  END IF;
  IF NOT has_function_privilege('telvyn_app','billing.ledger_post(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'DRIFT: telvyn_app must have EXECUTE on billing.ledger_post';
  END IF;

  -- ---- 10. Runtime role has NO direct DML/SELECT on the ledger tables -----
  FOR v_txt IN SELECT unnest(ARRAY['LedgerAccount','LedgerTransaction','LedgerLeg','IdempotencyKey']) LOOP
    IF has_table_privilege('telvyn_app','public.'||quote_ident(v_txt),'SELECT')
       OR has_table_privilege('telvyn_app','public.'||quote_ident(v_txt),'INSERT')
       OR has_table_privilege('telvyn_app','public.'||quote_ident(v_txt),'UPDATE')
       OR has_table_privilege('telvyn_app','public.'||quote_ident(v_txt),'DELETE')
       OR has_table_privilege('telvyn_app','public.'||quote_ident(v_txt),'TRUNCATE') THEN
      RAISE EXCEPTION 'DRIFT: telvyn_app must have NO direct privilege on public.%', v_txt;
    END IF;
  END LOOP;

  -- ---- 11. Function owner DML surface is minimal (no UPDATE/DELETE on history)
  IF has_table_privilege('telvyn_ledger_fn','public."LedgerTransaction"','UPDATE')
     OR has_table_privilege('telvyn_ledger_fn','public."LedgerTransaction"','DELETE')
     OR has_table_privilege('telvyn_ledger_fn','public."LedgerLeg"','UPDATE')
     OR has_table_privilege('telvyn_ledger_fn','public."LedgerLeg"','DELETE') THEN
    RAISE EXCEPTION 'DRIFT: telvyn_ledger_fn must not UPDATE/DELETE posted transactions or legs';
  END IF;

  -- ---- 12. No migrator↔fn membership lingering (deployment cleanup) --------
  SELECT count(*) INTO v FROM pg_auth_members m
    JOIN pg_roles c ON c.oid=m.member JOIN pg_roles p ON p.oid=m.roleid
   WHERE c.rolname='telvyn_migrator' AND p.rolname='telvyn_ledger_fn';
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: temporary telvyn_ledger_fn membership for telvyn_migrator still present'; END IF;
END
$$;

\echo 'LEDGER_DRIFT_OK: ledger schema, triggers, function, ownership and privileges verified.'

-- =============================================================================
-- BillingAccount foundation (Phase 13-2B S3; ADR-0022 Amendment 5 BA-01/02/04/
-- 05/06/13, X-1; owner S3 decisions S3-D1..D4 + E). The partial/expression
-- indexes, CHECKs and guard trigger are raw SQL that Prisma's schema-diff cannot
-- see — this block is their drift authority.
-- =============================================================================
DO $$
DECLARE
  v int; v_txt text; v_bool boolean;
BEGIN
  IF to_regclass('public."BillingAccount"') IS NULL THEN
    RAISE EXCEPTION 'DRIFT: table public.BillingAccount missing';
  END IF;

  -- Owner is mandatory; no soft-delete column (X-1).
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='BillingAccount'
     AND column_name='tenantId' AND is_nullable='NO';
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: BillingAccount.tenantId must be NOT NULL'; END IF;
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='BillingAccount' AND column_name='deletedAt';
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: BillingAccount must not have deletedAt (X-1)'; END IF;

  -- Every FK is ON DELETE RESTRICT; the lineage FK is composite (same tenant).
  SELECT count(*) INTO v FROM pg_constraint
   WHERE contype='f' AND conrelid='public."BillingAccount"'::regclass AND confdeltype <> 'r';
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: % BillingAccount FK(s) are not ON DELETE RESTRICT', v; END IF;
  SELECT count(*) INTO v FROM pg_constraint
   WHERE conname='BillingAccount_successorOfId_tenantId_fkey' AND contype='f'
     AND array_length(conkey,1)=2;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: same-tenant composite lineage FK missing'; END IF;

  -- Unique indexes: plain + composite + the two PARTIAL ones (with predicates).
  FOR v_txt IN SELECT unnest(ARRAY[
      'BillingAccount_accountNumber_key','BillingAccount_id_tenantId_key',
      'BillingAccount_successorOfId_tenantId_key','BillingAccount_tenantId_provisioningKey_key',
      'BillingAccount_tenantId_currency_default_key','BillingAccount_tenantId_label_open_key']) LOOP
    SELECT count(*) INTO v FROM pg_index ix JOIN pg_class c ON c.oid=ix.indexrelid
     WHERE c.relname=v_txt AND ix.indisunique AND ix.indrelid='public."BillingAccount"'::regclass;
    IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: unique index % missing', v_txt; END IF;
  END LOOP;
  SELECT pg_get_indexdef(c.oid) INTO v_txt FROM pg_class c
   WHERE c.relname='BillingAccount_tenantId_currency_default_key';
  IF v_txt NOT LIKE '%("tenantId", currency)%' OR v_txt NOT LIKE '%WHERE ("isDefault" AND%'
     OR v_txt NOT LIKE '%ACTIVE%' OR v_txt NOT LIKE '%SUSPENDED%' THEN
    RAISE EXCEPTION 'DRIFT: default-account partial index definition changed: %', v_txt;
  END IF;
  SELECT pg_get_indexdef(c.oid) INTO v_txt FROM pg_class c
   WHERE c.relname='BillingAccount_tenantId_label_open_key';
  IF v_txt NOT LIKE '%lower(btrim(label))%' OR v_txt NOT LIKE '%WHERE (status <> %CLOSED%' THEN
    RAISE EXCEPTION 'DRIFT: open-label partial index definition changed: %', v_txt;
  END IF;

  -- CHECKs.
  SELECT count(*) INTO v FROM pg_constraint
   WHERE conrelid='public."BillingAccount"'::regclass AND contype='c'
     AND conname IN ('BillingAccount_label_nonblank_chk','BillingAccount_no_self_succession_chk');
  IF v <> 2 THEN RAISE EXCEPTION 'DRIFT: BillingAccount CHECK constraints missing (found %)', v; END IF;

  -- Guard trigger: enabled, BEFORE INSERT OR UPDATE, row-level; function is
  -- SECURITY INVOKER with a hardened search_path.
  SELECT count(*) INTO v FROM pg_trigger
   WHERE tgname='billing_account_guard' AND tgrelid='public."BillingAccount"'::regclass
     AND tgenabled='O' AND (tgtype & 1)=1 AND (tgtype & 2)=2 AND (tgtype & 4)=4 AND (tgtype & 16)=16;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: billing_account_guard trigger missing, disabled or wrong timing/events'; END IF;
  SELECT count(*) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='billing' AND p.proname='billing_account_guard'
     AND NOT p.prosecdef AND 'search_path=pg_catalog, pg_temp' = ANY(p.proconfig);
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: billing.billing_account_guard must be SECURITY INVOKER with hardened search_path'; END IF;

  -- Runtime role holds NO privilege on BillingAccount in S3 (owner decision E);
  -- PUBLIC holds none either. (S5/S6/S8 will update this expectation.)
  FOR v_txt IN SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) LOOP
    IF has_table_privilege('telvyn_app','public."BillingAccount"',v_txt) THEN
      RAISE EXCEPTION 'DRIFT: telvyn_app must have NO % privilege on BillingAccount (S3)', v_txt;
    END IF;
  END LOOP;
  SELECT count(*) INTO v FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='BillingAccount' AND grantee IN ('telvyn_app','PUBLIC');
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: column-level privileges on BillingAccount must not exist in S3'; END IF;
  SELECT count(*) INTO v FROM information_schema.table_privileges
   WHERE table_schema='public' AND table_name='BillingAccount' AND grantee='PUBLIC';
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: PUBLIC must have no privilege on BillingAccount'; END IF;
END
$$;

\echo 'BILLING_ACCOUNT_DRIFT_OK: BillingAccount indexes, constraints, guard trigger and privileges verified.'
