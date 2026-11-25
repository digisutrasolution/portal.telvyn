-- =============================================================================
-- Telvyn — Ledger Foundation migration PRE-step (Phase 13-1B+C).
-- Establishes the TEMPORARY, privileged deployment capabilities the protected
-- ledger migration (20261125163000_ledger_foundation) needs, then hands off to
-- `prisma migrate deploy` (run as telvyn_migrator). Paired with
-- scripts/db/ledger-migration-post.sql, which REVOKES them after the migration
-- window and verifies cleanup.
--
-- RUN AS: the bootstrap admin (telvyn_ledger_admin on the isolated cluster; the
--         ephemeral CI postgres superuser in CI). NEVER as telvyn_app.
-- TARGET: -v db_name=<telvyn_ledger_dev|telvyn_ledger_e2e> (default dev); CI passes
--         its own db name. Identity + whitelist asserted (fail-closed).
--
-- Grants (both TEMPORARY, removed in the post-step):
--   * CREATE ON DATABASE  → telvyn_migrator  (so the migration can CREATE SCHEMA billing)
--   * telvyn_ledger_fn membership WITH INHERIT FALSE, SET TRUE → telvyn_migrator
--     (so the migration can ALTER FUNCTION billing.ledger_post OWNER TO telvyn_ledger_fn;
--      SET TRUE = may assume the owner role; INHERIT FALSE = does not silently
--      inherit its privileges; ADMIN option stays FALSE — asserted below).
-- This membership is a privileged DEPLOYMENT capability the runtime must never have.
-- =============================================================================

\set ON_ERROR_STOP on

SELECT NOT :{?db_name} AS _need_db_default \gset
\if :_need_db_default
  \set db_name telvyn_ledger_dev
\endif

-- Accept an explicit CI override of the identity whitelist (ephemeral CI DB name).
SELECT NOT :{?allow_ci} AS _need_allow_ci \gset
\if :_need_allow_ci
  \set allow_ci 0
\endif

SELECT set_config('telvyn.target_db', :'db_name', false);
SELECT set_config('telvyn.allow_ci', :'allow_ci', false);
DO $$
DECLARE
  target  text := current_setting('telvyn.target_db');
  allowci text := current_setting('telvyn.allow_ci');
BEGIN
  IF current_database() <> target THEN
    RAISE EXCEPTION 'ABORT: connected to %, expected %. Refusing ledger pre-step.', current_database(), target;
  END IF;
  IF allowci <> '1' AND target NOT IN ('telvyn_ledger_dev', 'telvyn_ledger_e2e') THEN
    RAISE EXCEPTION 'ABORT: % is not an authorized ledger database (set -v allow_ci=1 for CI).', target;
  END IF;
  IF current_setting('server_version_num')::int < 180000 THEN
    RAISE EXCEPTION 'ABORT: PostgreSQL % (< 18). Refusing.', current_setting('server_version');
  END IF;
  -- The three managed roles must already exist (bootstrap ran).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'telvyn_migrator')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'telvyn_ledger_fn')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'telvyn_app') THEN
    RAISE EXCEPTION 'ABORT: ledger roles are not bootstrapped.';
  END IF;
  -- telvyn_ledger_fn must be NOLOGIN / non-super before we grant SET membership.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'telvyn_ledger_fn' AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'ABORT: telvyn_ledger_fn has unexpected elevated attributes.';
  END IF;
END
$$;

GRANT CREATE ON DATABASE :"db_name" TO telvyn_migrator;
GRANT telvyn_ledger_fn TO telvyn_migrator WITH INHERIT FALSE, SET TRUE;

-- Assert the membership was created with ADMIN OPTION = FALSE (the migrator must
-- not be able to re-grant the owner role or escape cleanup).
DO $$
DECLARE v_admin boolean; v_set boolean; v_inherit boolean;
BEGIN
  SELECT m.admin_option, m.set_option, m.inherit_option
    INTO v_admin, v_set, v_inherit
    FROM pg_auth_members m
    JOIN pg_roles c ON c.oid = m.member
    JOIN pg_roles p ON p.oid = m.roleid
   WHERE c.rolname = 'telvyn_migrator' AND p.rolname = 'telvyn_ledger_fn';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ABORT: fn membership was not established.';
  END IF;
  IF v_admin IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ABORT: fn membership admin_option must be FALSE (got %).', v_admin;
  END IF;
  IF v_set IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ABORT: fn membership set_option must be TRUE for ownership transfer.';
  END IF;
  IF v_inherit IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ABORT: fn membership inherit_option must be FALSE (no silent inheritance).';
  END IF;
END
$$;

\echo 'LEDGER_PRE_OK: temporary deployment capabilities granted to telvyn_migrator.'
