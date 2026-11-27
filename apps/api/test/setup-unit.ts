/**
 * Unit-lane setup — INC-DB-001B.
 *
 * Unit tests never need a database or Redis. Before any unit file is imported,
 * the data-plane variables are pinned to an unresolvable `.invalid` sentinel
 * (RFC 6761) and the E2E variables are removed. Because they are set, Prisma's
 * automatic `apps/api/.env` load (which never overrides an existing variable)
 * and `dotenv/config` cannot inject a real target; any accidental connection
 * attempt fails to resolve instead of reaching a service.
 */
const SENTINEL_PG = "postgresql://unit-tests-must-not-connect@unit-lane.invalid:1/none";
const SENTINEL_REDIS = "redis://unit-lane.invalid:1";

process.env.DATABASE_URL = SENTINEL_PG;
process.env.REDIS_URL = SENTINEL_REDIS;
delete process.env.E2E_FIXTURE_DATABASE_URL;
delete process.env.TELVYN_E2E_PROFILE;
delete process.env.TELVYN_E2E_ALLOW_TARGET;
