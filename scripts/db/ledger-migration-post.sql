-- =============================================================================
-- Telvyn — Ledger Foundation migration POST-step (Phase 13-1B+C).
-- Revokes the TEMPORARY deployment capabilities granted by
-- scripts/db/ledger-migration-pre.sql and FAILS CLOSED if either does not come
-- off cleanly (a security cleanup failure must fail the deployment — it is never
-- silently continued).
--
-- RUN AS: the bootstrap admin (telvyn_ledger_admin / the ephemeral CI superuser),
--         AFTER `prisma migrate deploy` completes (on success OR failure — the
--         temporary grants must never persist past the migration window).
-- TARGET: -v db_name=<...> (default dev); -v allow_ci=1 to permit a CI db name.
-- =============================================================================

\set ON_ERROR_STOP on

SELECT NOT :{?db_name} AS _need_db_default \gset
\if :_need_db_default
  \set db_name telvyn_ledger_dev
\endif
SELECT NOT :{?allow_ci} AS _need_allow_ci \gset
\if :_need_allow_ci
  \set allow_ci 0
\endif

SELECT set_config('telvyn.target_db', :'db_name', false);
SELECT set_config('telvyn.allow_ci', :'allow_ci', false);
DO $$
DECLARE target text := current_setting('telvyn.target_db'); allowci text := current_setting('telvyn.allow_ci');
BEGIN
  IF current_database() <> target THEN
    RAISE EXCEPTION 'ABORT: connected to %, expected %. Refusing ledger post-step.', current_database(), target;
  END IF;
  IF allowci <> '1' AND target NOT IN ('telvyn_ledger_dev', 'telvyn_ledger_e2e') THEN
    RAISE EXCEPTION 'ABORT: % is not an authorized ledger database.', target;
  END IF;
END
$$;

-- Revoke the temporary deployment capabilities (idempotent).
REVOKE telvyn_ledger_fn FROM telvyn_migrator;
REVOKE CREATE ON DATABASE :"db_name" FROM telvyn_migrator;

-- Fail closed if cleanup did not take.
DO $$
DECLARE n int; v_can boolean;
BEGIN
  SELECT count(*) INTO n
    FROM pg_auth_members m
    JOIN pg_roles c ON c.oid = m.member
    JOIN pg_roles p ON p.oid = m.roleid
   WHERE c.rolname = 'telvyn_migrator' AND p.rolname = 'telvyn_ledger_fn';
  IF n <> 0 THEN
    RAISE EXCEPTION 'ABORT: temporary telvyn_ledger_fn membership was NOT removed (cleanup failure).';
  END IF;

  SELECT has_database_privilege('telvyn_migrator', current_database(), 'CREATE') INTO v_can;
  IF v_can THEN
    RAISE EXCEPTION 'ABORT: temporary CREATE ON DATABASE was NOT revoked from telvyn_migrator (cleanup failure).';
  END IF;

  -- Defense in depth: the migrator must not retain any membership of the owner
  -- role, and the owner must remain NOLOGIN / non-super.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'telvyn_ledger_fn' AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'ABORT: telvyn_ledger_fn has unexpected elevated attributes post-migration.';
  END IF;
END
$$;

\echo 'LEDGER_POST_OK: temporary deployment capabilities revoked and verified.'
