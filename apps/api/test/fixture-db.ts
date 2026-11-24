/**
 * Privileged E2E fixture connection (Slice 13-1A.4b).
 *
 * E2E setup/teardown must insert and (cascade-)delete across ALL tables —
 * including append-only audit/event tables (e.g. FraudEvent cascades from
 * Tenant) that the restricted runtime role (telvyn_app, used by the application
 * under test via DATABASE_URL) is correctly FORBIDDEN from mutating. Per the
 * isolation plan, that privileged fixture work uses a SEPARATE connection — it
 * never elevates telvyn_app.
 *
 * Connection precedence:
 *   E2E_FIXTURE_DATABASE_URL  (the isolated telvyn_migrator on the disposable
 *                              telvyn_ledger_e2e DB), else
 *   DATABASE_URL              (single-role environments / CI).
 *
 * This is test-only infrastructure; it is never imported by application code.
 */
import { PrismaClient } from "@prisma/client";

const fixtureUrl = process.env.E2E_FIXTURE_DATABASE_URL ?? process.env.DATABASE_URL;

export const fixturePrisma = fixtureUrl
  ? new PrismaClient({ datasources: { db: { url: fixtureUrl } } })
  : new PrismaClient();
