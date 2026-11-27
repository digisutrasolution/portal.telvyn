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

-- =============================================================================
-- Financial authorization foundation (Phase 13-2B S1; ADR-0022 Amendment 5
-- BA-08/BA-15; owner decisions G1/G2). StepUpGrant CHECKs, guard trigger and the
-- narrow runtime grant are raw SQL — this block is their drift authority.
-- =============================================================================
DO $$
DECLARE
  v int; v_txt text;
BEGIN
  IF to_regclass('public."StepUpGrant"') IS NULL THEN
    RAISE EXCEPTION 'DRIFT: table public.StepUpGrant missing';
  END IF;
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='User' AND column_name='mfaLastTotpStep';
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: User.mfaLastTotpStep (TOTP replay guard) missing'; END IF;

  -- Grants are evidence: no soft delete/updatedAt; every FK ON DELETE RESTRICT.
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='StepUpGrant' AND column_name IN ('deletedAt','updatedAt');
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: StepUpGrant must not have deletedAt/updatedAt'; END IF;
  SELECT count(*) INTO v FROM pg_constraint
   WHERE contype='f' AND conrelid='public."StepUpGrant"'::regclass AND confdeltype = 'r';
  IF v <> 3 THEN RAISE EXCEPTION 'DRIFT: StepUpGrant must have 3 ON DELETE RESTRICT FKs (found %)', v; END IF;

  -- CHECKs: purpose format + 300 s lifetime (owner decision G1).
  SELECT count(*) INTO v FROM pg_constraint
   WHERE conrelid='public."StepUpGrant"'::regclass AND contype='c'
     AND conname IN ('StepUpGrant_purpose_format_chk','StepUpGrant_lifetime_chk');
  IF v <> 2 THEN RAISE EXCEPTION 'DRIFT: StepUpGrant CHECK constraints missing (found %)', v; END IF;
  SELECT pg_get_constraintdef(oid) INTO v_txt FROM pg_constraint WHERE conname='StepUpGrant_lifetime_chk';
  IF v_txt NOT LIKE '%00:05:00%' AND v_txt NOT LIKE '%300 seconds%' THEN
    RAISE EXCEPTION 'DRIFT: StepUpGrant lifetime bound changed: %', v_txt;
  END IF;

  -- Guard trigger: enabled, BEFORE INSERT OR UPDATE, row-level, SECURITY INVOKER.
  SELECT count(*) INTO v FROM pg_trigger
   WHERE tgname='step_up_grant_guard' AND tgrelid='public."StepUpGrant"'::regclass
     AND tgenabled='O' AND (tgtype & 1)=1 AND (tgtype & 2)=2 AND (tgtype & 4)=4 AND (tgtype & 16)=16;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: step_up_grant_guard trigger missing, disabled or wrong timing/events'; END IF;
  SELECT count(*) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='billing' AND p.proname='step_up_grant_guard'
     AND NOT p.prosecdef AND 'search_path=pg_catalog, pg_temp' = ANY(p.proconfig);
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: billing.step_up_grant_guard must be SECURITY INVOKER with hardened search_path'; END IF;

  -- Runtime: SELECT + INSERT + UPDATE("consumedAt") only (owner decision G2).
  IF NOT has_table_privilege('telvyn_app','public."StepUpGrant"','SELECT')
     OR NOT has_table_privilege('telvyn_app','public."StepUpGrant"','INSERT') THEN
    RAISE EXCEPTION 'DRIFT: telvyn_app must have SELECT and INSERT on StepUpGrant';
  END IF;
  FOR v_txt IN SELECT unnest(ARRAY['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) LOOP
    IF has_table_privilege('telvyn_app','public."StepUpGrant"',v_txt) THEN
      RAISE EXCEPTION 'DRIFT: telvyn_app must NOT have table-level % on StepUpGrant', v_txt;
    END IF;
  END LOOP;
  SELECT count(*) INTO v FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='StepUpGrant' AND grantee='telvyn_app'
     AND privilege_type='UPDATE';
  IF v <> 1 OR NOT has_column_privilege('telvyn_app','public."StepUpGrant"','consumedAt','UPDATE') THEN
    RAISE EXCEPTION 'DRIFT: telvyn_app must have UPDATE on StepUpGrant."consumedAt" ONLY (found % column grants)', v;
  END IF;
  SELECT count(*) INTO v FROM information_schema.table_privileges
   WHERE table_schema='public' AND table_name='StepUpGrant' AND grantee='PUBLIC';
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: PUBLIC must have no privilege on StepUpGrant'; END IF;

  -- wallet.credit is retired (BA-08): no permission row, hence no grant.
  SELECT count(*) INTO v FROM public."Permission" WHERE "key"='wallet.credit';
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: retired permission wallet.credit still present'; END IF;
END
$$;

\echo 'FINANCIAL_AUTHZ_DRIFT_OK: StepUpGrant constraints, guard trigger, runtime grant and wallet.credit retirement verified.'

-- =============================================================================
-- Financial audit foundation (Phase 13-2B S2; ADR-0022 Amendment 5 BA-14; owner
-- decisions F1-F7). FinancialAuditEvent CHECKs, guard triggers and the
-- append-only runtime grant are raw SQL - this block is their drift authority.
-- =============================================================================
DO $$
DECLARE
  v int; v_txt text;
BEGIN
  IF to_regclass('public."FinancialAuditEvent"') IS NULL THEN
    RAISE EXCEPTION 'DRIFT: table public.FinancialAuditEvent missing';
  END IF;

  -- Evidence: no soft delete/updatedAt; all 6 FKs ON DELETE RESTRICT + ON UPDATE RESTRICT.
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='FinancialAuditEvent' AND column_name IN ('deletedAt','updatedAt');
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: FinancialAuditEvent must not have deletedAt/updatedAt'; END IF;
  SELECT count(*) INTO v FROM pg_constraint
   WHERE contype='f' AND conrelid='public."FinancialAuditEvent"'::regclass
     AND confdeltype='r' AND confupdtype='r';
  IF v <> 6 THEN RAISE EXCEPTION 'DRIFT: FinancialAuditEvent must have 6 RESTRICT/RESTRICT FKs (found %)', v; END IF;
  -- Same-tenant account attribution (F4): composite FK (billingAccountId, tenantId).
  SELECT count(*) INTO v FROM pg_constraint
   WHERE conname='FinancialAuditEvent_billingAccountId_tenantId_fkey' AND contype='f'
     AND confrelid='public."BillingAccount"'::regclass AND array_length(conkey,1)=2;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: composite BillingAccount FK (billingAccountId, tenantId) missing'; END IF;

  -- CHECKs: identifier formats, correlation length, metadata shape (F1/F5/F7).
  SELECT count(*) INTO v FROM pg_constraint
   WHERE conrelid='public."FinancialAuditEvent"'::regclass AND contype='c'
     AND conname IN ('FinancialAuditEvent_operation_format_chk','FinancialAuditEvent_permission_format_chk',
                     'FinancialAuditEvent_reason_code_format_chk','FinancialAuditEvent_correlation_id_len_chk',
                     'FinancialAuditEvent_before_shape_chk','FinancialAuditEvent_after_shape_chk',
                     'FinancialAuditEvent_details_shape_chk');
  IF v <> 7 THEN RAISE EXCEPTION 'DRIFT: FinancialAuditEvent CHECK constraints missing (found % of 7)', v; END IF;
  SELECT prosrc INTO v_txt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='billing' AND p.proname='financial_audit_json_ok' AND p.provolatile='i';
  IF v_txt IS NULL OR v_txt NOT LIKE '%4096%' OR v_txt NOT LIKE '%<= 50%' THEN
    RAISE EXCEPTION 'DRIFT: billing.financial_audit_json_ok missing, not IMMUTABLE, or bounds changed';
  END IF;

  -- Guard triggers: row BEFORE INSERT/UPDATE/DELETE + statement BEFORE TRUNCATE, enabled.
  SELECT count(*) INTO v FROM pg_trigger
   WHERE tgname='financial_audit_event_guard' AND tgrelid='public."FinancialAuditEvent"'::regclass
     AND tgenabled='O' AND (tgtype & 1)=1 AND (tgtype & 2)=2 AND (tgtype & 4)=4 AND (tgtype & 8)=8 AND (tgtype & 16)=16;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: financial_audit_event_guard trigger missing, disabled or wrong timing/events'; END IF;
  SELECT count(*) INTO v FROM pg_trigger
   WHERE tgname='financial_audit_event_no_truncate' AND tgrelid='public."FinancialAuditEvent"'::regclass
     AND tgenabled='O' AND (tgtype & 1)=0 AND (tgtype & 2)=2 AND (tgtype & 32)=32;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: financial_audit_event_no_truncate trigger missing, disabled or wrong timing'; END IF;
  SELECT count(*) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='billing' AND p.proname IN ('financial_audit_event_guard','financial_audit_json_ok')
     AND NOT p.prosecdef AND 'search_path=pg_catalog, pg_temp' = ANY(p.proconfig);
  IF v <> 2 THEN RAISE EXCEPTION 'DRIFT: financial audit functions must be SECURITY INVOKER with hardened search_path'; END IF;

  -- Runtime: INSERT only (F6; S5 O7 revoked SELECT — no table or column SELECT);
  -- no column grants; PUBLIC nothing.
  IF NOT has_table_privilege('telvyn_app','public."FinancialAuditEvent"','INSERT') THEN
    RAISE EXCEPTION 'DRIFT: telvyn_app must have INSERT on FinancialAuditEvent';
  END IF;
  IF has_any_column_privilege('telvyn_app','public."FinancialAuditEvent"','SELECT') THEN
    RAISE EXCEPTION 'DRIFT: telvyn_app must have NO SELECT (table or column) on FinancialAuditEvent (S5 O7)';
  END IF;
  FOR v_txt IN SELECT unnest(ARRAY['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) LOOP
    IF has_table_privilege('telvyn_app','public."FinancialAuditEvent"',v_txt) THEN
      RAISE EXCEPTION 'DRIFT: telvyn_app must NOT have % on FinancialAuditEvent', v_txt;
    END IF;
  END LOOP;
  SELECT count(*) INTO v FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='FinancialAuditEvent' AND grantee='telvyn_app'
     AND privilege_type IN ('UPDATE','REFERENCES');
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: telvyn_app must have no column-level UPDATE/REFERENCES on FinancialAuditEvent'; END IF;
  SELECT count(*) INTO v FROM information_schema.table_privileges
   WHERE table_schema='public' AND table_name='FinancialAuditEvent' AND grantee='PUBLIC';
  IF v <> 0 THEN RAISE EXCEPTION 'DRIFT: PUBLIC must have no privilege on FinancialAuditEvent'; END IF;
END
$$;

\echo 'FINANCIAL_AUDIT_DRIFT_OK: FinancialAuditEvent constraints, guard triggers and append-only runtime grant verified.'

-- =============================================================================
-- Chart of Accounts foundation (Phase 13-2B S4; ADR-0022 Amendment 5 BA-10; owner
-- decisions D1-D6). The CHECKs, partial expression unique index, link guard and
-- the restricted account-opening function are raw SQL - this block is their
-- drift authority. S4 is INERT: the runtime role must NOT execute the function.
-- =============================================================================
DO $$
DECLARE
  v int; v_txt text;
  fn constant text := 'billing.ledger_account_open(uuid,uuid,"Currency",text)';
BEGIN
  -- Link column: nullable uuid (NULL for platform / pre-S4 accounts).
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='LedgerAccount' AND column_name='billingAccountId'
     AND data_type='uuid' AND is_nullable='YES';
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: LedgerAccount.billingAccountId must be a nullable uuid'; END IF;

  -- Composite same-tenant + same-currency FK, RESTRICT/RESTRICT, onto the
  -- (id, tenantId, currency) unique identity of BillingAccount.
  SELECT count(*) INTO v FROM pg_constraint
   WHERE conname='LedgerAccount_billingAccountId_tenantId_currency_fkey' AND contype='f'
     AND conrelid='public."LedgerAccount"'::regclass AND confrelid='public."BillingAccount"'::regclass
     AND array_length(conkey,1)=3 AND confdeltype='r' AND confupdtype='r';
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: composite LedgerAccount -> BillingAccount FK missing or not RESTRICT/RESTRICT'; END IF;
  SELECT count(*) INTO v FROM pg_index ix JOIN pg_class c ON c.oid=ix.indexrelid
   WHERE c.relname='BillingAccount_id_tenantId_currency_key' AND ix.indisunique
     AND ix.indrelid='public."BillingAccount"'::regclass;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: unique BillingAccount(id, tenantId, currency) missing'; END IF;

  -- CHECKs: link needs a tenant (MATCH SIMPLE bypass closed); approved taxonomy
  -- shape; reserved prefix. All must be validated.
  SELECT count(*) INTO v FROM pg_constraint
   WHERE conrelid='public."LedgerAccount"'::regclass AND contype='c' AND convalidated
     AND conname IN ('LedgerAccount_billing_link_tenant_chk','LedgerAccount_billing_link_taxonomy_chk',
                     'LedgerAccount_customer_funds_reserved_chk');
  IF v <> 3 THEN RAISE EXCEPTION 'DRIFT: LedgerAccount S4 CHECK constraints missing or not validated (found % of 3)', v; END IF;
  SELECT pg_get_constraintdef(oid) INTO v_txt FROM pg_constraint WHERE conname='LedgerAccount_billing_link_taxonomy_chk';
  IF v_txt NOT LIKE '%customer_funds:%' OR v_txt NOT LIKE '%LIABILITY%' OR v_txt NOT LIKE '%CREDIT%' THEN
    RAISE EXCEPTION 'DRIFT: approved taxonomy CHECK changed: %', v_txt;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_txt FROM pg_constraint WHERE conname='LedgerAccount_billing_link_tenant_chk';
  IF v_txt NOT LIKE '%"billingAccountId" IS NULL%' OR v_txt NOT LIKE '%"tenantId" IS NOT NULL%' THEN
    RAISE EXCEPTION 'DRIFT: link-requires-tenant CHECK changed: %', v_txt;
  END IF;

  -- One account per (BillingAccount, taxonomy): partial expression unique index.
  SELECT pg_get_indexdef(c.oid) INTO v_txt FROM pg_class c JOIN pg_index ix ON ix.indexrelid=c.oid
   WHERE c.relname='LedgerAccount_billingAccountId_taxonomy_key' AND ix.indisunique;
  IF v_txt IS NULL OR v_txt NOT LIKE '%split_part(code, %'
     OR v_txt NOT LIKE '%WHERE ("billingAccountId" IS NOT NULL)%' THEN
    RAISE EXCEPTION 'DRIFT: per-account taxonomy unique index missing or changed: %', coalesce(v_txt,'<none>');
  END IF;

  -- Link guard: enabled, row-level BEFORE INSERT OR UPDATE, SECURITY INVOKER.
  SELECT count(*) INTO v FROM pg_trigger
   WHERE tgname='ledger_account_link_guard' AND tgrelid='public."LedgerAccount"'::regclass
     AND tgenabled='O' AND (tgtype & 1)=1 AND (tgtype & 2)=2 AND (tgtype & 4)=4 AND (tgtype & 16)=16;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: ledger_account_link_guard trigger missing, disabled or wrong timing/events'; END IF;
  SELECT count(*) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='billing' AND p.proname='ledger_account_link_guard'
     AND NOT p.prosecdef AND 'search_path=pg_catalog, pg_temp' = ANY(p.proconfig);
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: billing.ledger_account_link_guard must be SECURITY INVOKER with hardened search_path'; END IF;
  -- The pre-existing identity guard is still in force (LG011 not weakened).
  SELECT count(*) INTO v FROM pg_trigger
   WHERE tgname='ledger_account_guard' AND tgrelid='public."LedgerAccount"'::regclass AND tgenabled='O';
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: ledger_account_guard trigger missing or disabled'; END IF;

  -- Opening function: SECURITY DEFINER, owner telvyn_ledger_fn, hardened path,
  -- no dynamic SQL; PUBLIC and the runtime role cannot execute it (inert S4).
  SELECT count(*) INTO v FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
   WHERE n.nspname='billing' AND p.proname='ledger_account_open' AND p.prosecdef
     AND r.rolname='telvyn_ledger_fn' AND 'search_path=pg_catalog, pg_temp' = ANY(p.proconfig)
     AND p.prosrc !~* '\mexecute\M' AND p.prosrc !~* '\mformat\s*\(';
  IF v <> 1 THEN
    RAISE EXCEPTION 'DRIFT: billing.ledger_account_open must be SECURITY DEFINER, owned by telvyn_ledger_fn, hardened search_path, no dynamic SQL';
  END IF;
  IF has_function_privilege('public', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'DRIFT: PUBLIC must not have EXECUTE on billing.ledger_account_open';
  END IF;
  IF has_function_privilege('telvyn_app', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'DRIFT: telvyn_app must NOT have EXECUTE on billing.ledger_account_open in S4 (inert until S5)';
  END IF;
  -- Exactly one explicit grantee: telvyn_migrator (table owner; privilege-neutral
  -- verification path). Any other grantee is drift.
  SELECT string_agg(a.grantee::regrole::text, ',' ORDER BY a.grantee::regrole::text) INTO v_txt
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = to_regprocedure(fn) AND a.privilege_type='EXECUTE'
     AND a.grantee <> p.proowner;
  IF v_txt IS DISTINCT FROM 'telvyn_migrator' THEN
    RAISE EXCEPTION 'DRIFT: billing.ledger_account_open EXECUTE grantees changed: %', coalesce(v_txt,'<none>');
  END IF;

  -- Function-owner privileges are minimal and column-scoped.
  IF has_table_privilege('telvyn_ledger_fn','public."LedgerAccount"','INSERT')
     OR has_table_privilege('telvyn_ledger_fn','public."LedgerAccount"','UPDATE')
     OR has_table_privilege('telvyn_ledger_fn','public."LedgerAccount"','DELETE')
     OR has_table_privilege('telvyn_ledger_fn','public."LedgerAccount"','TRUNCATE') THEN
    RAISE EXCEPTION 'DRIFT: telvyn_ledger_fn must hold no table-level INSERT/UPDATE/DELETE/TRUNCATE on LedgerAccount';
  END IF;
  SELECT string_agg(column_name::text, ',' ORDER BY column_name::text) INTO v_txt
    FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='LedgerAccount' AND grantee='telvyn_ledger_fn'
     AND privilege_type='INSERT';
  IF v_txt IS DISTINCT FROM 'billingAccountId,code,currency,name,normalBalance,tenantId,type' THEN
    RAISE EXCEPTION 'DRIFT: telvyn_ledger_fn LedgerAccount INSERT columns changed: %', coalesce(v_txt,'<none>');
  END IF;
  FOR v_txt IN SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) LOOP
    IF has_table_privilege('telvyn_ledger_fn','public."BillingAccount"',v_txt) THEN
      RAISE EXCEPTION 'DRIFT: telvyn_ledger_fn must hold no table-level % on BillingAccount', v_txt;
    END IF;
  END LOOP;
  SELECT string_agg(privilege_type::text||':'||column_name::text, ',' ORDER BY privilege_type::text, column_name::text) INTO v_txt
    FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='BillingAccount' AND grantee='telvyn_ledger_fn';
  -- S4 set, extended by S5 (provisioning INSERT columns + replay/conflict reads).
  IF v_txt IS DISTINCT FROM 'INSERT:accountNumber,INSERT:currency,INSERT:isDefault,INSERT:label,INSERT:mode,INSERT:provisionedByUserId,INSERT:provisioningFingerprint,INSERT:provisioningKey,INSERT:tenantId,INSERT:updatedAt,SELECT:accountNumber,SELECT:createdAt,SELECT:currency,SELECT:id,SELECT:isDefault,SELECT:label,SELECT:mode,SELECT:provisionedByUserId,SELECT:provisioningFingerprint,SELECT:provisioningKey,SELECT:status,SELECT:tenantId,UPDATE:statusChangedAt' THEN
    RAISE EXCEPTION 'DRIFT: telvyn_ledger_fn BillingAccount column privileges changed: %', coalesce(v_txt,'<none>');
  END IF;
END
$$;

\echo 'CHART_OF_ACCOUNTS_DRIFT_OK: LedgerAccount link, constraints, link guard, opening function and privileges verified.'

-- =============================================================================
-- BillingAccount provisioning (Phase 13-2B S5; ADR-0022 Amendment 5 BA-03/08/14/15;
-- owner decisions O1-O7). Format CHECKs, the provisioning + completeness
-- functions and triggers, function ACLs and the function-owner column grants are
-- raw SQL - this block is their drift authority.
-- =============================================================================
DO $$
DECLARE
  v int; v_txt text; v_sig text;
BEGIN
  v_sig := 'billing.billing_account_provision(uuid,uuid,uuid,uuid,"Currency",text,boolean,text,text,text)';
  IF to_regprocedure(v_sig) IS NULL THEN
    RAISE EXCEPTION 'DRIFT: billing.billing_account_provision missing';
  END IF;

  -- provisionedByUserId: nullable uuid, FK RESTRICT/RESTRICT to User.
  SELECT count(*) INTO v FROM pg_constraint
   WHERE conname='BillingAccount_provisionedByUserId_fkey' AND contype='f'
     AND conrelid='public."BillingAccount"'::regclass AND confrelid='public."User"'::regclass
     AND confdeltype='r' AND confupdtype='r';
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: BillingAccount.provisionedByUserId FK (RESTRICT/RESTRICT) missing'; END IF;

  -- Format CHECKs (O3/O5): present with the exact patterns (NOT VALID is expected).
  FOR v_txt IN SELECT unnest(ARRAY[
      'BillingAccount_account_number_format_chk|^BA-[0-9]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$',
      'BillingAccount_provisioning_key_format_chk|^[A-Za-z0-9._:-]{16,128}$',
      'BillingAccount_provisioning_fingerprint_format_chk|^v1:[0-9a-f]{64}$']) LOOP
    SELECT count(*) INTO v FROM pg_constraint
     WHERE conrelid='public."BillingAccount"'::regclass AND contype='c'
       AND conname=split_part(v_txt,'|',1)
       AND strpos(pg_get_constraintdef(oid), split_part(v_txt,'|',2)) > 0;
    IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: CHECK % missing or pattern changed', split_part(v_txt,'|',1); END IF;
  END LOOP;

  -- Attribution guard: BEFORE UPDATE row trigger, enabled; INVOKER, hardened.
  SELECT count(*) INTO v FROM pg_trigger
   WHERE tgname='billing_account_provisioning_guard' AND tgrelid='public."BillingAccount"'::regclass
     AND tgenabled='O' AND (tgtype & 1)=1 AND (tgtype & 2)=2 AND (tgtype & 16)=16;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: billing_account_provisioning_guard trigger missing, disabled or wrong timing'; END IF;
  SELECT count(*) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='billing' AND p.proname='billing_account_provisioning_guard'
     AND NOT p.prosecdef AND 'search_path=pg_catalog, pg_temp' = ANY(p.proconfig);
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: billing_account_provisioning_guard must be SECURITY INVOKER with hardened search_path'; END IF;

  -- Completeness: DEFERRABLE INITIALLY DEFERRED AFTER INSERT constraint trigger, enabled.
  SELECT count(*) INTO v FROM pg_trigger t
   WHERE t.tgname='billing_account_provision_complete' AND t.tgrelid='public."BillingAccount"'::regclass
     AND t.tgenabled='O' AND t.tgconstraint <> 0 AND t.tgdeferrable AND t.tginitdeferred
     AND (t.tgtype & 1)=1 AND (t.tgtype & 2)=0 AND (t.tgtype & 4)=4;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: billing_account_provision_complete deferred constraint trigger missing or changed'; END IF;

  -- Both SECURITY DEFINER functions: owner telvyn_ledger_fn, hardened search_path.
  SELECT count(*) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='billing' AND p.proname IN ('billing_account_provision','billing_account_provision_complete')
     AND p.prosecdef AND pg_get_userbyid(p.proowner)='telvyn_ledger_fn'
     AND 'search_path=pg_catalog, pg_temp' = ANY(p.proconfig);
  IF v <> 2 THEN RAISE EXCEPTION 'DRIFT: provisioning functions must be SECURITY DEFINER, owned by telvyn_ledger_fn, hardened'; END IF;
  SELECT prosrc INTO v_txt FROM pg_proc WHERE oid = to_regprocedure(v_sig);
  IF v_txt NOT LIKE '%BP001%' OR v_txt NOT LIKE '%BP002%' OR v_txt NOT LIKE '%BP003%'
     OR v_txt NOT LIKE '%consumedAt" = transaction_timestamp()%' OR v_txt NOT LIKE '%billing.account.provision%'
     OR v_txt NOT LIKE '%''PLATFORM''%' OR v_txt NOT LIKE '%ON CONFLICT DO NOTHING%' OR v_txt NOT LIKE '%''PREPAID''%'
     OR v_txt ILIKE '%EXECUTE %' THEN
    RAISE EXCEPTION 'DRIFT: billing_account_provision body lost an authority check or gained dynamic SQL';
  END IF;

  -- Function ACLs: provision = {telvyn_ledger_fn owner, telvyn_app}; complete = owner only;
  -- no PUBLIC; ledger_account_open still has NO runtime EXECUTE.
  SELECT string_agg(DISTINCT pg_get_userbyid(a.grantee), ',' ORDER BY pg_get_userbyid(a.grantee)) INTO v_txt
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = to_regprocedure(v_sig) AND a.privilege_type='EXECUTE';
  IF v_txt IS DISTINCT FROM 'telvyn_app,telvyn_ledger_fn' THEN
    RAISE EXCEPTION 'DRIFT: billing_account_provision EXECUTE grantees changed: %', coalesce(v_txt,'<none>');
  END IF;
  SELECT string_agg(DISTINCT pg_get_userbyid(a.grantee), ',') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, aclexplode(p.proacl) a
   WHERE n.nspname='billing' AND p.proname='billing_account_provision_complete' AND a.privilege_type='EXECUTE';
  IF v_txt IS DISTINCT FROM 'telvyn_ledger_fn' THEN
    RAISE EXCEPTION 'DRIFT: billing_account_provision_complete EXECUTE grantees changed: %', coalesce(v_txt,'<none>');
  END IF;
  IF has_function_privilege('telvyn_app', 'billing.ledger_account_open(uuid,uuid,"Currency",text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'DRIFT: telvyn_app must NOT execute billing.ledger_account_open (reachable only via provisioning)';
  END IF;

  -- Function-owner privileges are column-scoped reads plus the exact BillingAccount insert columns.
  SELECT count(*) INTO v FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='BillingAccount' AND grantee='telvyn_ledger_fn' AND privilege_type='INSERT';
  IF v <> 10 THEN RAISE EXCEPTION 'DRIFT: telvyn_ledger_fn must have INSERT on exactly 10 BillingAccount columns (found %)', v; END IF;
  FOR v_txt IN SELECT unnest(ARRAY['Tenant','Membership','User','MembershipRole','Role','RolePermission','Permission','StepUpGrant','FinancialAuditEvent']) LOOP
    IF has_table_privilege('telvyn_ledger_fn', format('public.%I', v_txt), 'SELECT')
       OR has_table_privilege('telvyn_ledger_fn', format('public.%I', v_txt), 'INSERT')
       OR has_table_privilege('telvyn_ledger_fn', format('public.%I', v_txt), 'UPDATE')
       OR has_table_privilege('telvyn_ledger_fn', format('public.%I', v_txt), 'DELETE') THEN
      RAISE EXCEPTION 'DRIFT: telvyn_ledger_fn must hold only column-level SELECT on %', v_txt;
    END IF;
  END LOOP;
  IF has_column_privilege('telvyn_ledger_fn','public."User"','passwordHash','SELECT')
     OR has_column_privilege('telvyn_ledger_fn','public."User"','mfaSecretEnc','SELECT') THEN
    RAISE EXCEPTION 'DRIFT: telvyn_ledger_fn must not read credential columns of User';
  END IF;

  -- O6: no network data in new financial audit rows.
  SELECT count(*) INTO v FROM pg_constraint
   WHERE conname='FinancialAuditEvent_no_network_data_chk' AND contype='c'
     AND conrelid='public."FinancialAuditEvent"'::regclass;
  IF v <> 1 THEN RAISE EXCEPTION 'DRIFT: FinancialAuditEvent_no_network_data_chk missing'; END IF;

  -- Runtime still holds NO privilege on BillingAccount (provisioning is via the function only).
  IF has_any_column_privilege('telvyn_app','public."BillingAccount"','SELECT')
     OR has_any_column_privilege('telvyn_app','public."BillingAccount"','INSERT')
     OR has_any_column_privilege('telvyn_app','public."BillingAccount"','UPDATE') THEN
    RAISE EXCEPTION 'DRIFT: telvyn_app must hold no privilege on BillingAccount (S5 provisions via the function only)';
  END IF;
END
$$;

\echo 'BILLING_ACCOUNT_PROVISIONING_DRIFT_OK: provisioning function, completeness trigger, formats, ACLs and owner privileges verified.'
