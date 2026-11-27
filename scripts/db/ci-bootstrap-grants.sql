-- =============================================================================
-- Telvyn - CI EPHEMERAL runtime grant matrix (Slice 13-1A.7A).
-- Companion to scripts/db/ci-bootstrap-roles.sql.
--
-- RUN ORDER: AFTER ci-bootstrap-roles.sql AND after `prisma migrate deploy`
-- (run as telvyn_migrator) has created the application tables.
--
-- Grants the restricted runtime role (telvyn_app) the minimum table privileges
-- for the EXISTING application modules in the ephemeral CI database. Same
-- security rules as scripts/db/ledger-dev-grants.sql: append-only audit/event
-- tables stay immutable to runtime (SELECT+INSERT only); runtime gets nothing on
-- _prisma_migrations; NO blanket future-table grant / NO default privileges.
--
-- RUN AS: the ephemeral CI bootstrap administrator.
-- SAFETY: requires -v ci_ephemeral=1 and -v db_name=<database> (asserted).
-- =============================================================================

\set ON_ERROR_STOP on

-- Require the explicit ephemeral-CI flag (fail closed - NON-ZERO exit - if absent/!=1).
SELECT NOT :{?ci_ephemeral} AS _need_flag \gset
\if :_need_flag
  \set ci_ephemeral 0
\endif
SELECT set_config('telvyn.ci_ephemeral', :'ci_ephemeral', false);
DO $$ BEGIN
  IF current_setting('telvyn.ci_ephemeral', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'ABORT: ci-bootstrap-grants.sql requires -v ci_ephemeral=1 (ephemeral CI context only).';
  END IF;
END $$;

SELECT set_config('telvyn.ci_db', :'db_name', false);
DO $$
DECLARE
  t text;
  target text := current_setting('telvyn.ci_db');
  -- Append-only tables: runtime may read + insert, never update/delete
  -- (audit/security immutability). Verified against app code (no update/delete).
  immutable_tables text[] := ARRAY[
    'AuditLog', 'SecurityEvent', 'LoginAttempt', 'HealthEvent', 'FraudEvent'
  ];
  -- Financial ledger tables (Phase 13-1B+C): runtime gets NO direct DML at all —
  -- the ONLY sanctioned write path is EXECUTE billing.ledger_post (SECURITY
  -- DEFINER), granted by the ledger migration itself; reads are via restricted
  -- projections in a later slice. They are explicitly EXCLUDED from this generic
  -- runtime grant loop so telvyn_app can never INSERT/UPDATE/DELETE/SELECT them.
  ledger_tables text[] := ARRAY[
    'LedgerAccount', 'LedgerTransaction', 'LedgerLeg', 'IdempotencyKey'
  ];
  -- Commercial billing tables with NO runtime privilege yet (Phase 13-2B S3,
  -- owner decision E — least privilege). Excluded from this loop and actively
  -- revoked so a re-run can never widen access. BillingAccount gains exactly
  -- SELECT+INSERT with S5, column-level UPDATE with S6 — never DELETE (BA-13).
  no_runtime_tables text[] := ARRAY[
    'BillingAccount'
  ];
  -- Financial step-up grants (Phase 13-2B S1, BA-15, owner decision G2): runtime
  -- may read and issue grants and stamp "consumedAt" ONLY - no DELETE and no
  -- UPDATE of any binding column. Handled explicitly, never by the generic grant.
  step_up_tables text[] := ARRAY[
    'StepUpGrant'
  ];
  -- Financial audit events (Phase 13-2B S2, BA-14, owner decision F6; S5 O7):
  -- runtime may APPEND ONLY - no SELECT (the writer inserts without RETURNING),
  -- no UPDATE/DELETE/TRUNCATE (a guard trigger also refuses them). Handled
  -- explicitly, never by the generic grant.
  financial_audit_tables text[] := ARRAY[
    'FinancialAuditEvent'
  ];
BEGIN
  IF current_database() <> target THEN
    RAISE EXCEPTION 'ABORT: connected to %, expected %. Refusing to grant.', current_database(), target;
  END IF;

  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  LOOP
    IF t = ANY(ledger_tables) THEN
      CONTINUE;  -- ledger tables: runtime has EXECUTE on ledger_post only, no table DML
    ELSIF t = ANY(no_runtime_tables) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM telvyn_app', t);
    ELSIF t = ANY(step_up_tables) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM telvyn_app', t);
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO telvyn_app', t);
      EXECUTE format('GRANT UPDATE (%I) ON public.%I TO telvyn_app', 'consumedAt', t);
    ELSIF t = ANY(financial_audit_tables) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM telvyn_app', t);
      EXECUTE format('GRANT INSERT ON public.%I TO telvyn_app', t);
    ELSIF t = ANY(immutable_tables) THEN
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO telvyn_app', t);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO telvyn_app', t);
    END IF;
  END LOOP;

  -- Runtime must NOT touch migration metadata.
  EXECUTE 'REVOKE ALL ON public."_prisma_migrations" FROM telvyn_app';
END
$$;

-- No sequences in this schema (uuidv7() PKs); if ever introduced, grant
-- USAGE, SELECT on them explicitly here - never a blanket future grant.
