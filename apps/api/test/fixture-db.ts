/**
 * Privileged E2E fixture connection (Slice 13-1A.4b; hardened INC-DB-001B).
 *
 * E2E setup/teardown must insert and (cascade-)delete across tables —
 * including append-only audit/event tables (e.g. FraudEvent cascades from
 * Tenant) that the restricted runtime role (telvyn_app, used by the application
 * under test via DATABASE_URL) is correctly FORBIDDEN from mutating. That
 * privileged fixture work uses a SEPARATE connection (telvyn_migrator) — it
 * never elevates telvyn_app.
 *
 * Guarded initialization: the worker guard is imported first, so this module
 * throws before constructing a client unless Gate A passed for this worker and
 * Gate B verified the same targets. The client is built from the validated
 * E2E_FIXTURE_DATABASE_URL only — there is no DATABASE_URL, default-client or
 * `.env` fallback.
 *
 * This is test-only infrastructure; it is never imported by application code.
 */
import { E2E_TARGET } from "./e2e-guard";
import { PrismaClient } from "@prisma/client";

void E2E_TARGET;

export const fixturePrisma = new PrismaClient({
  datasources: { db: { url: process.env.E2E_FIXTURE_DATABASE_URL as string } },
});
