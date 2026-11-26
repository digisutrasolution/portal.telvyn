-- =============================================================================
-- Telvyn — Ledger Foundation ISOLATED dev/test cluster: runtime grant matrix
-- Phase 13, Slice 13-1A.4.  Companion to scripts/db/ledger-dev-bootstrap.sql.
--
-- RUN ORDER: AFTER scripts/db/ledger-dev-bootstrap.sql AND after the baseline
-- Prisma migrations have created the application tables (the tables must exist).
--
-- SCOPE: grants the runtime role (telvyn_app) the minimum table privileges for
-- the EXISTING application modules, on the ISOLATED NON-PRODUCTION cluster only.
--
-- PROPERTIES:
--   * Identity-asserted + fail-closed (aborts if not telvyn_ledger_dev).
--   * Idempotent / repeatable.
--   * Append-only audit/event tables are immutable to runtime (SELECT, INSERT only).
--   * Runtime gets NO access to _prisma_migrations (no app dependency).
--   * NO blanket future-table grant and NO ALTER DEFAULT PRIVILEGES — future
--     ledger tables (13-1B+C) are intentionally left OUTSIDE ordinary runtime CRUD.
--   * telvyn_app has no ownership, no DDL, no schema CREATE (granted elsewhere).
--
-- TARGET DATABASE: set with  -v db_name=<name>  (default: telvyn_ledger_dev).
-- RUN AS: the isolated bootstrap admin (telvyn_ledger_admin) only.
-- =============================================================================

\set ON_ERROR_STOP on

-- Default the target database name when the caller did not pass -v db_name=...
SELECT NOT :{?db_name} AS _need_db_default \gset
\if :_need_db_default
  \set db_name telvyn_ledger_dev
\endif

-- Target name passed via a session GUC (psql does not substitute :'db_name'
-- inside dollar-quoted blocks).
SELECT set_config('telvyn.target_db', :'db_name', false);
DO $$
DECLARE
  t text;
  target text := current_setting('telvyn.target_db');
  -- Append-only tables: runtime may read + insert, never update/delete
  -- (audit/security immutability — SECURITY.md, constitution). Verified against
  -- app code: no update/delete/upsert is issued on any of these.
  immutable_tables text[] := ARRAY[
    'AuditLog', 'SecurityEvent', 'LoginAttempt', 'HealthEvent', 'FraudEvent'
  ];
  -- Financial ledger tables (Phase 13-1B+C): runtime gets NO direct DML — the
  -- only write path is EXECUTE billing.ledger_post (granted by the ledger
  -- migration). Excluded from this generic loop so telvyn_app can never
  -- INSERT/UPDATE/DELETE/SELECT them directly.
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
BEGIN
  -- Identity + whitelist assertion — fail closed.
  IF current_database() <> target THEN
    RAISE EXCEPTION 'ABORT: connected to %, expected %. Refusing to grant.', current_database(), target;
  END IF;
  IF target NOT IN ('telvyn_ledger_dev', 'telvyn_ledger_e2e') THEN
    RAISE EXCEPTION 'ABORT: % is not an authorized isolated ledger database.', target;
  END IF;

  -- Per-table grants over CURRENT application tables only (never ALL + future).
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  LOOP
    IF t = ANY(ledger_tables) THEN
      CONTINUE;  -- ledger tables: EXECUTE on ledger_post only, no runtime table DML
    ELSIF t = ANY(no_runtime_tables) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM telvyn_app', t);
    ELSIF t = ANY(step_up_tables) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM telvyn_app', t);
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO telvyn_app', t);
      EXECUTE format('GRANT UPDATE (%I) ON public.%I TO telvyn_app', 'consumedAt', t);
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

-- There are no sequences in this schema (uuidv7() primary keys); if any are ever
-- introduced, grant USAGE, SELECT on them explicitly here — never a blanket future grant.
