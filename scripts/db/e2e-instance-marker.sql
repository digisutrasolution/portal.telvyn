-- INC-DB-001B — mark a DISPOSABLE PostgreSQL database as an E2E test instance.
--
-- Sets the database-level setting `telvyn.e2e_instance`, which the E2E Gate B
-- identity check (apps/api/test/e2e-target-guard.ts) requires before any E2E
-- test file runs. A database without this marker is refused, so the native /
-- legacy / FMC / production databases — which are never marked — cannot be an
-- E2E target. This is a safety interlock, not a security boundary.
--
-- No schema object is created; nothing here is a migration. The setting lives
-- in pg_db_role_setting and applies to NEW sessions.
--
-- Run as the database owner / bootstrap admin, connected to the target DB:
--   local:  psql -U telvyn_ledger_admin -d telvyn_ledger_e2e -v ON_ERROR_STOP=1 \
--             -v db_name=telvyn_ledger_e2e -v marker=telvyn-e2e/local-isolated -v ci_ephemeral=0 \
--             -f scripts/db/e2e-instance-marker.sql
--   CI:     psql "$CI_PG_ADMIN_URL" -v ON_ERROR_STOP=1 \
--             -v db_name=telvyn -v marker=telvyn-e2e/ci-ephemeral -v ci_ephemeral=1 \
--             -f scripts/db/e2e-instance-marker.sql
--   verify: psql -U telvyn -d telvyn_safety_verify -v ON_ERROR_STOP=1 \
--             -v db_name=telvyn_safety_verify -v marker=telvyn-inc-db-001b-local-verify -v ci_ephemeral=0 \
--             -f scripts/db/e2e-instance-marker.sql   (disposable local-verify environment only)
-- Only these three (database, marker) pairs are accepted; anything else aborts.
\set ON_ERROR_STOP on

SELECT set_config('telvyn_mark.db', :'db_name', false),
       set_config('telvyn_mark.value', :'marker', false),
       set_config('telvyn_mark.ci', :'ci_ephemeral', false);

DO $$
DECLARE
  v_db     text := current_setting('telvyn_mark.db');
  v_marker text := current_setting('telvyn_mark.value');
  v_ci     text := current_setting('telvyn_mark.ci');
BEGIN
  IF current_database() <> v_db THEN
    RAISE EXCEPTION 'e2e marker: connected database does not match db_name; refusing';
  END IF;
  IF current_setting('server_version_num')::int < 180000 THEN
    RAISE EXCEPTION 'e2e marker: server is older than PostgreSQL 18; refusing';
  END IF;
  IF NOT (
       (v_db = 'telvyn_ledger_e2e' AND v_marker = 'telvyn-e2e/local-isolated' AND v_ci = '0')
    OR (v_db = 'telvyn_safety_verify' AND v_marker = 'telvyn-inc-db-001b-local-verify' AND v_ci = '0')
    OR (v_db = 'telvyn'            AND v_marker = 'telvyn-e2e/ci-ephemeral'   AND v_ci = '1'
        AND current_setting('telvyn_mark.ci') = '1')
  ) THEN
    RAISE EXCEPTION 'e2e marker: (database, marker) pair is not an approved E2E instance; refusing';
  END IF;
  EXECUTE format('ALTER DATABASE %I SET telvyn.e2e_instance = %L', v_db, v_marker);
END $$;

SELECT 'E2E_INSTANCE_MARKER_OK' AS result;
