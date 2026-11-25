-- =============================================================================
-- Telvyn - CI EPHEMERAL least-privilege role bootstrap (Slice 13-1A.7A).
--
-- Creates the three ledger roles in a FRESH, ephemeral CI PostgreSQL service so
-- the restricted-role model (same as the isolated dev cluster) is exercised in
-- ordinary remote CI, before `prisma migrate deploy` runs as telvyn_migrator.
--
-- Companion: scripts/db/ci-bootstrap-grants.sql (post-migration runtime grants).
-- Mirrors the security model of scripts/db/ledger-dev-bootstrap.sql; it does NOT
-- replace or weaken that script's isolated-target guard.
--
-- RUN AS: the ephemeral CI bootstrap administrator (the POSTGRES_USER of the
-- throwaway CI postgres service). Contains NO passwords - login-role passwords
-- are set by a separate, masked CI step with per-run ephemeral credentials.
--
-- SAFETY: this script refuses to run unless the caller passes BOTH
--   -v ci_ephemeral=1        (explicit ephemeral-CI execution context)
--   -v db_name=<database>    (asserted against the live connection)
-- An env/flag alone is not treated as isolation proof: role creation is
-- fail-closed on any pre-existing managed role with unexpected attributes.
-- =============================================================================

\set ON_ERROR_STOP on

-- Require the explicit ephemeral-CI flag (fail closed - NON-ZERO exit - if
-- absent or != 1). Default to 0 when unset, then assert via RAISE so a missing
-- flag aborts the CI step (a \quit would exit 0 and silently skip the bootstrap).
SELECT NOT :{?ci_ephemeral} AS _need_flag \gset
\if :_need_flag
  \set ci_ephemeral 0
\endif
SELECT set_config('telvyn.ci_ephemeral', :'ci_ephemeral', false);
DO $$ BEGIN
  IF current_setting('telvyn.ci_ephemeral', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'ABORT: ci-bootstrap-roles.sql requires -v ci_ephemeral=1 (ephemeral CI context only).';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 0. Identity assertion (DB name must match the one the caller declares).
-- ----------------------------------------------------------------------------
SELECT set_config('telvyn.ci_db', :'db_name', false);
DO $$
DECLARE target text := current_setting('telvyn.ci_db');
BEGIN
  -- (a) DB identity matches the caller's declared name.
  IF current_database() <> target THEN
    RAISE EXCEPTION 'ABORT: connected to %, expected %. Refusing CI bootstrap.', current_database(), target;
  END IF;
  -- (b) Expected PostgreSQL major version (design requires PG >= 18).
  IF current_setting('server_version_num')::int < 180000 THEN
    RAISE EXCEPTION 'ABORT: PostgreSQL % (< 18). Refusing CI bootstrap.', current_setting('server_version');
  END IF;
  -- (c) Fresh, pre-migration state: an initialized/migrated database (a shared
  --     dev/prod DB) has _prisma_migrations. The CI bootstrap runs BEFORE
  --     migrations, so its absence is an additional guard that this is a fresh
  --     ephemeral CI database - a redirected DATABASE_URL to a populated DB is
  --     refused here, not only by the db-name/flag checks.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_prisma_migrations') THEN
    RAISE EXCEPTION 'ABORT: _prisma_migrations present - not a fresh pre-migration database. Refusing CI bootstrap.';
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 1. Role creation (idempotent; fail-closed on unexpected elevated attributes).
--    Login roles are created WITHOUT a password here; the separate masked CI
--    step sets per-run ephemeral passwords. telvyn_ledger_fn is NOLOGIN.
-- ----------------------------------------------------------------------------
DO $$
DECLARE r pg_roles%ROWTYPE;
BEGIN
  -- telvyn_migrator - owns the application schema objects, runs the migrations.
  SELECT * INTO r FROM pg_roles WHERE rolname = 'telvyn_migrator';
  IF NOT FOUND THEN
    CREATE ROLE telvyn_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  ELSE
    IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication THEN
      RAISE EXCEPTION 'ABORT: telvyn_migrator exists with elevated attributes; refusing to adopt.';
    END IF;
    ALTER ROLE telvyn_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  END IF;

  -- telvyn_ledger_fn - future SECURITY DEFINER function owner (13-1B+C). NOLOGIN,
  -- no privileges here (no ledger objects exist in this slice).
  SELECT * INTO r FROM pg_roles WHERE rolname = 'telvyn_ledger_fn';
  IF NOT FOUND THEN
    CREATE ROLE telvyn_ledger_fn NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  ELSE
    IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR r.rolcanlogin THEN
      RAISE EXCEPTION 'ABORT: telvyn_ledger_fn exists with unexpected attributes; refusing to adopt.';
    END IF;
    ALTER ROLE telvyn_ledger_fn NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  END IF;

  -- telvyn_app - restricted runtime application role.
  SELECT * INTO r FROM pg_roles WHERE rolname = 'telvyn_app';
  IF NOT FOUND THEN
    CREATE ROLE telvyn_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  ELSE
    IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication THEN
      RAISE EXCEPTION 'ABORT: telvyn_app exists with elevated attributes; refusing to adopt.';
    END IF;
    ALTER ROLE telvyn_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. Membership guard - no managed role may be a member of another managed role
--    (no SET ROLE escalation). This bootstrap grants NO role memberships.
-- ----------------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_auth_members m
  JOIN pg_roles child  ON child.oid  = m.member
  JOIN pg_roles parent ON parent.oid = m.roleid
  WHERE child.rolname IN ('telvyn_migrator','telvyn_app','telvyn_ledger_fn');
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: a managed role unexpectedly holds a role membership; refusing (SET ROLE escalation risk).';
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 3. PUBLIC hardening + explicit least-privilege grants.
-- ----------------------------------------------------------------------------
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
REVOKE ALL ON SCHEMA  public      FROM PUBLIC;

-- Migrator: connect, use + CREATE in public (owns the objects it creates).
GRANT CONNECT ON DATABASE :"db_name" TO telvyn_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO telvyn_migrator;

-- App: connect + USE public, NO CREATE (no DDL / object creation).
GRANT CONNECT ON DATABASE :"db_name" TO telvyn_app;
GRANT USAGE ON SCHEMA public         TO telvyn_app;

-- telvyn_ledger_fn: intentionally no privileges (no ledger objects this slice).
-- NO ALTER DEFAULT PRIVILEGES - future financial tables are not auto-exposed.
