-- =============================================================================
-- Telvyn — Ledger Foundation ISOLATED dev/test cluster: role + privilege bootstrap
-- Phase 13, Slice 13-1A.4 (parameterized in 13-1A.4b).
-- Companion: scripts/db/ledger-dev-grants.sql (post-migration).
--
-- SCOPE: creates the least-privilege role architecture and database/schema
-- privileges for an ISOLATED, NON-PRODUCTION PostgreSQL 18 database in the
-- Compose project telvyn-ledger-dev (container telvyn-ledger-dev-pg, host
-- 127.0.0.1:5434 -> internal 5432). It is NOT the dev DB on :5432/:5433.
--
-- TARGET DATABASE: set with  -v db_name=<name>  (default: telvyn_ledger_dev).
-- Only the two authorized isolated ledger databases are accepted; any other
-- name aborts. The roles are CLUSTER-GLOBAL and created once; re-running for a
-- second database only (re)applies that database's PUBLIC hardening + grants.
--
-- PROPERTIES:
--   * Asserts the authorized database identity AND a name whitelist (fail-closed).
--   * Idempotent / repeatable without privilege escalation.
--   * Fails closed if a managed role already exists with elevated attributes.
--   * Never adopts unrelated roles (touches only the three named roles).
--   * Contains NO passwords and NO SCRAM verifiers (credentials are set by a
--     separate, gitignored step — never in tracked SQL).
--   * No ledger objects, no ledger grants (deferred to 13-1B+C).
--
-- RUN AS: the isolated bootstrap admin (telvyn_ledger_admin) only.
-- =============================================================================

\set ON_ERROR_STOP on

-- Default the target database name when the caller did not pass -v db_name=...
SELECT NOT :{?db_name} AS _need_db_default \gset
\if :_need_db_default
  \set db_name telvyn_ledger_dev
\endif

-- ----------------------------------------------------------------------------
-- 0. Identity + whitelist assertion — fail closed on the wrong or a non-isolated DB.
--    The target name is passed into the DO block via a session GUC because psql
--    does not substitute :'db_name' inside dollar-quoted blocks.
-- ----------------------------------------------------------------------------
SELECT set_config('telvyn.target_db', :'db_name', false);
DO $$
DECLARE target text := current_setting('telvyn.target_db');
BEGIN
  IF current_database() <> target THEN
    RAISE EXCEPTION 'ABORT: connected to database %, expected %. Refusing to bootstrap.',
      current_database(), target;
  END IF;
  IF target NOT IN ('telvyn_ledger_dev', 'telvyn_ledger_e2e') THEN
    RAISE EXCEPTION 'ABORT: % is not an authorized isolated ledger database.', target;
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 1. Role creation (idempotent, fail-closed on unexpected elevated attributes).
--    Login roles are created WITHOUT a password here; passwords are set by the
--    separate gitignored credential step, so a role cannot authenticate until
--    then (fail-closed). telvyn_ledger_fn is NOLOGIN by design. Roles are
--    cluster-global: this block is a no-op (attribute re-assert) on re-run.
-- ----------------------------------------------------------------------------
DO $$
DECLARE r pg_roles%ROWTYPE;
BEGIN
  -- A. telvyn_migrator — owns application schema objects, runs the migration
  --    chain. LOGIN, but never used for runtime application traffic.
  SELECT * INTO r FROM pg_roles WHERE rolname = 'telvyn_migrator';
  IF NOT FOUND THEN
    CREATE ROLE telvyn_migrator
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  ELSE
    IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication THEN
      RAISE EXCEPTION 'ABORT: role telvyn_migrator already exists with elevated attributes; refusing to adopt.';
    END IF;
    ALTER ROLE telvyn_migrator
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  END IF;

  -- B. telvyn_ledger_fn — future SECURITY DEFINER function owner. NOLOGIN.
  --    Created with NO privileges, NO memberships, NO ownership (13-1B+C grants).
  SELECT * INTO r FROM pg_roles WHERE rolname = 'telvyn_ledger_fn';
  IF NOT FOUND THEN
    CREATE ROLE telvyn_ledger_fn
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  ELSE
    IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR r.rolcanlogin THEN
      RAISE EXCEPTION 'ABORT: role telvyn_ledger_fn already exists with unexpected attributes; refusing to adopt.';
    END IF;
    ALTER ROLE telvyn_ledger_fn
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  END IF;

  -- C. telvyn_app — runtime application role. LOGIN, least privilege, no DDL,
  --    no ownership, no schema CREATE, no privileged memberships.
  SELECT * INTO r FROM pg_roles WHERE rolname = 'telvyn_app';
  IF NOT FOUND THEN
    CREATE ROLE telvyn_app
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  ELSE
    IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication THEN
      RAISE EXCEPTION 'ABORT: role telvyn_app already exists with elevated attributes; refusing to adopt.';
    END IF;
    ALTER ROLE telvyn_app
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. Membership guard — no managed role may be a member of another managed or
--    privileged role (defeats SET ROLE escalation; NOINHERIT alone is not relied
--    upon). This bootstrap grants NO role memberships at all.
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
-- 3. PUBLIC hardening — strip default CONNECT/TEMP on the database and
--    USAGE/CREATE on the public schema from PUBLIC, then grant back explicitly.
-- ----------------------------------------------------------------------------
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
REVOKE ALL ON SCHEMA  public      FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 4. Explicit database + schema privileges (least privilege).
-- ----------------------------------------------------------------------------
-- Migrator: connect, use and CREATE in public (owns the objects it creates).
GRANT CONNECT ON DATABASE :"db_name" TO telvyn_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO telvyn_migrator;

-- App: connect and USE public, but NO CREATE (no DDL, no object creation).
GRANT CONNECT ON DATABASE :"db_name" TO telvyn_app;
GRANT USAGE ON SCHEMA public         TO telvyn_app;

-- telvyn_ledger_fn: intentionally no database/schema/table privileges yet.
-- (Function ownership + restricted EXECUTE land in 13-1B+C, under new authorization.)

-- NOTE: No ALTER DEFAULT PRIVILEGES are set here. Future ledger tables must NOT
-- be auto-exposed to runtime CRUD; per-table grants are applied explicitly in
-- scripts/db/ledger-dev-grants.sql after the baseline migrations create the tables.
