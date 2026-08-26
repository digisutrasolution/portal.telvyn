-- ADR-0004 defense-in-depth: PostgreSQL Row-Level Security on tenant-owned
-- tables. The application layer (scoped Prisma client) is sufficient for
-- correctness; RLS guarantees that even an app-layer bug cannot leak across
-- tenants. Apply this AFTER `prisma migrate deploy`, and run the API under a
-- NON-BYPASSRLS role that issues `SET LOCAL app.tenant_id = '<uuid>'` per
-- request transaction (wired at deploy — Phase 20 / DEVOPS).
--
-- Idempotent: safe to re-run.

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['Membership', 'Role', 'AuditLog'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

-- Role note: create the app role WITHOUT BYPASSRLS, e.g.
--   CREATE ROLE telvyn_app LOGIN PASSWORD '...' NOBYPASSRLS;
--   GRANT ... ON ALL TABLES IN SCHEMA public TO telvyn_app;
-- and connect the API as telvyn_app in production. `current_setting(..., true)`
-- returns NULL when unset, so a query with no tenant context matches no rows.
