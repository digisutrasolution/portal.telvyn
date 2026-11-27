/**
 * Fail-closed E2E target guard — INC-DB-001B.
 *
 * Two stages, both mandatory, both fail closed:
 *
 *   Gate A (PRE-connection, pure): validates the explicitly supplied
 *   environment — profile, URL syntax, protocol, host, EXTERNAL (published)
 *   port, database name, Redis logical DB, and expected role names. It opens
 *   no socket. Nothing in Gate A can prove *which* server answers; it only
 *   refuses configurations that are not on the profile's allowlist and every
 *   configuration that names a protected port.
 *
 *   Gate B (POST-connection identity): after Gate A passes, read-only probes
 *   connect and verify the server actually answering is the marked disposable
 *   test instance: current_database(), current_user, restricted runtime-role
 *   attributes, fixture role, PostgreSQL major version, both connections on
 *   the same server, all repository migrations applied, the per-database test
 *   instance marker, and the Redis instance marker + logical DB. Gate B is
 *   necessarily post-connection: markers live on the server, so verifying them
 *   requires a connection. It issues reads only; on any failure the run aborts
 *   before any test file (and therefore any fixture write or cleanup) executes.
 *
 * Docker port mapping: the published HOST port (e.g. 127.0.0.1:5434) is checked
 * in Gate A from the URL. The server-side port (inet_server_port(), normally
 * 5432 inside a container) is reported by Gate B but deliberately NOT required
 * to equal the host port.
 *
 * Profiles (TELVYN_E2E_PROFILE, required — there is no default):
 *   local-isolated  the Compose project `telvyn-ledger-dev` (PG 127.0.0.1:5434,
 *                   DB telvyn_ledger_e2e; Redis 127.0.0.1:6381 db 0).
 *   local-verify    the dedicated disposable safety-verification environment,
 *                   Compose project `telvyn-inc-db-001b-verify` (PG 127.0.0.1:5435,
 *                   DB telvyn_safety_verify; Redis 127.0.0.1:6382 db 0).
 *   verify-clean    the clean disposable verification environment migrated from an
 *                   empty database (Phase 13-2B S5), Compose project
 *                   `telvyn-verify-clean` (PG 127.0.0.1:5436, DB telvyn_clean_verify;
 *                   Redis 127.0.0.1:6383 db 0).
 *   ci-ephemeral    the GitHub Actions service containers (PG published on
 *                   55432, DB telvyn; Redis published on 56379 db 0). Requires
 *                   the GitHub Actions runtime variables AND the CI-bootstrap
 *                   markers verified in Gate B — the profile name alone, CI=true,
 *                   NODE_ENV=test or a database name never authorize a target.
 *
 * This is a safety interlock against operator/config mistakes. It is not a
 * security boundary against a privileged or malicious operator, who can always
 * forge markers on a server they control.
 *
 * Diagnostics never include credentials or raw URLs.
 */
import { createHash } from "node:crypto";

export type E2eProfileName = "local-isolated" | "local-verify" | "verify-clean" | "ci-ephemeral";

interface PgExpectation {
  hosts: readonly string[];
  port: number;
  database: string;
  appUser: string;
  fixtureUser: string;
}
interface RedisExpectation {
  hosts: readonly string[];
  port: number;
  db: number;
}
export interface E2eProfile {
  name: E2eProfileName;
  pg: PgExpectation;
  redis: RedisExpectation;
  /** Value of the DB-level setting `telvyn.e2e_instance` on the target database. */
  dbMarker: string;
  /** Value of the Redis key REDIS_MARKER_KEY on the target logical DB. */
  redisMarker: string;
  /** Extra environment preconditions (beyond the profile variable). */
  requireEnv: Readonly<Record<string, string>>;
}

/** Ports that are never a valid E2E target in ANY profile (native/legacy/FMC). */
export const PROTECTED_PG_PORTS: readonly number[] = [5432, 5433];
export const PROTECTED_REDIS_PORTS: readonly number[] = [6379, 6380];
const ALL_PROTECTED_PORTS = new Set<number>([...PROTECTED_PG_PORTS, ...PROTECTED_REDIS_PORTS]);

export const DB_MARKER_SETTING = "telvyn.e2e_instance";
export const REDIS_MARKER_KEY = "telvyn:e2e:instance-marker";
export const MIN_SERVER_VERSION_NUM = 180000;

export const E2E_PROFILES: Readonly<Record<E2eProfileName, E2eProfile>> = {
  "local-isolated": {
    name: "local-isolated",
    pg: { hosts: ["127.0.0.1"], port: 5434, database: "telvyn_ledger_e2e", appUser: "telvyn_app", fixtureUser: "telvyn_migrator" },
    redis: { hosts: ["127.0.0.1"], port: 6381, db: 0 },
    dbMarker: "telvyn-e2e/local-isolated",
    redisMarker: "telvyn-e2e/local-isolated",
    requireEnv: {},
  },
  // INC-DB-001B-PRE2: the dedicated disposable safety-verification environment
  // (Compose project `telvyn-inc-db-001b-verify`, docker-compose.local-verify.yml).
  // Exact targets only — no host/port/database override exists.
  "local-verify": {
    name: "local-verify",
    pg: { hosts: ["127.0.0.1"], port: 5435, database: "telvyn_safety_verify", appUser: "telvyn_app", fixtureUser: "telvyn_migrator" },
    redis: { hosts: ["127.0.0.1"], port: 6382, db: 0 },
    dbMarker: "telvyn-inc-db-001b-local-verify",
    redisMarker: "telvyn-inc-db-001b-local-verify",
    requireEnv: {},
  },
  // Phase 13-2B S5: the CLEAN disposable verification environment (Compose project
  // `telvyn-verify-clean`, docker-compose.verify-clean.yml), migrated from an empty
  // database. Exact targets only — no host/port/database override exists.
  "verify-clean": {
    name: "verify-clean",
    pg: { hosts: ["127.0.0.1"], port: 5436, database: "telvyn_clean_verify", appUser: "telvyn_app", fixtureUser: "telvyn_migrator" },
    redis: { hosts: ["127.0.0.1"], port: 6383, db: 0 },
    dbMarker: "telvyn-verify-clean",
    redisMarker: "telvyn-verify-clean",
    requireEnv: {},
  },
  "ci-ephemeral": {
    name: "ci-ephemeral",
    pg: { hosts: ["localhost", "127.0.0.1"], port: 55432, database: "telvyn", appUser: "telvyn_app", fixtureUser: "telvyn_migrator" },
    redis: { hosts: ["localhost", "127.0.0.1"], port: 56379, db: 0 },
    dbMarker: "telvyn-e2e/ci-ephemeral",
    redisMarker: "telvyn-e2e/ci-ephemeral",
    requireEnv: { GITHUB_ACTIONS: "true", CI: "true" },
  },
};

/** Variables that once (or elsewhere) bypassed host/DB checks — refused outright. */
const RETIRED_OVERRIDES = ["TELVYN_E2E_ALLOW_TARGET"] as const;

export class E2eTargetError extends Error {
  constructor(
    readonly gate: "A" | "B",
    readonly code: string,
    message: string,
  ) {
    super(`[e2e-target-guard] Gate ${gate} ${code}: ${message}`);
    this.name = "E2eTargetError";
  }
}
const failA = (code: string, msg: string): never => {
  throw new E2eTargetError("A", code, msg);
};
const failB = (code: string, msg: string): never => {
  throw new E2eTargetError("B", code, msg);
};

export interface PgTarget {
  host: string;
  port: number;
  database: string;
  user: string;
}
export interface RedisTarget {
  host: string;
  port: number;
  db: number;
}
export interface GateAResult {
  profile: E2eProfile;
  app: PgTarget;
  fixture: PgTarget;
  redis: RedisTarget;
  /** Credential-free identity of the validated targets (stable across processes). */
  fingerprint: string;
}

type Env = Readonly<Record<string, string | undefined>>;

function parseUrl(label: string, raw: string | undefined): URL {
  if (raw === undefined || raw.trim() === "") failA("MISSING_URL", `${label} must be explicitly set (no fallback, no .env).`);
  try {
    return new URL(raw as string);
  } catch {
    return failA("MALFORMED_URL", `${label} is not a valid URL.`);
  }
}

function parsePort(label: string, u: URL): number {
  if (u.port === "") failA("MISSING_PORT", `${label} must state an explicit port.`);
  const port = Number(u.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) failA("BAD_PORT", `${label} has an invalid port.`);
  return port;
}

function parsePg(label: string, raw: string | undefined, exp: PgExpectation, expectedUser: string): PgTarget {
  const u = parseUrl(label, raw);
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") failA("BAD_PROTOCOL", `${label} must use the postgresql scheme.`);
  const port = parsePort(label, u);
  if (ALL_PROTECTED_PORTS.has(port)) failA("PROTECTED_PORT", `${label} names protected port ${port}; refusing.`);
  const host = u.hostname.toLowerCase();
  if (!exp.hosts.includes(host)) failA("HOST_NOT_ALLOWED", `${label} host is not on the profile allowlist.`);
  if (port !== exp.port) failA("PORT_NOT_ALLOWED", `${label} port ${port} is not the profile's published port ${exp.port}.`);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (database !== exp.database) failA("DATABASE_NOT_ALLOWED", `${label} database is not the profile's database.`);
  const user = decodeURIComponent(u.username);
  if (user !== expectedUser) failA("ROLE_NOT_ALLOWED", `${label} role is not the expected ${expectedUser}.`);
  // L1: a URL fragment is never meaningful for a database target, and a repeated
  // parameter is ambiguous (drivers may honour a different occurrence than this check).
  if (u.hash !== "") failA("BAD_QUERY", `${label} must not carry a URL fragment.`);
  for (const key of u.searchParams.keys()) {
    if (key !== "schema") failA("BAD_QUERY", `${label} carries an unsupported query parameter.`);
    if (u.searchParams.getAll(key).length > 1) failA("BAD_QUERY", `${label} repeats a query parameter.`);
  }
  const schema = u.searchParams.get("schema");
  if (schema !== null && schema !== "public") failA("BAD_QUERY", `${label} schema must be public.`);
  return { host, port, database, user };
}

function parseRedis(raw: string | undefined, exp: RedisExpectation): RedisTarget {
  const u = parseUrl("REDIS_URL", raw);
  if (u.protocol !== "redis:") failA("BAD_PROTOCOL", "REDIS_URL must use the plain redis scheme.");
  const port = parsePort("REDIS_URL", u);
  if (ALL_PROTECTED_PORTS.has(port)) failA("PROTECTED_PORT", `REDIS_URL names protected port ${port}; refusing.`);
  const host = u.hostname.toLowerCase();
  if (!exp.hosts.includes(host)) failA("HOST_NOT_ALLOWED", "REDIS_URL host is not on the profile allowlist.");
  if (port !== exp.port) failA("PORT_NOT_ALLOWED", `REDIS_URL port ${port} is not the profile's published port ${exp.port}.`);
  const path = u.pathname.replace(/^\//, "");
  if (path !== "" && !/^\d+$/.test(path)) failA("BAD_REDIS_DB", "REDIS_URL logical DB must be a number.");
  const db = path === "" ? 0 : Number(path);
  if (db !== exp.db) failA("REDIS_DB_NOT_ALLOWED", `REDIS_URL logical DB ${db} is not the profile's DB ${exp.db}.`);
  if (u.search !== "") failA("BAD_QUERY", "REDIS_URL must not carry query parameters.");
  if (u.hash !== "") failA("BAD_QUERY", "REDIS_URL must not carry a URL fragment.");
  return { host, port, db };
}

export function fingerprintOf(profile: E2eProfileName, app: PgTarget, fixture: PgTarget, redis: RedisTarget): string {
  const id = [
    profile,
    `${app.host}:${app.port}/${app.database}@${app.user}`,
    `${fixture.host}:${fixture.port}/${fixture.database}@${fixture.user}`,
    `${redis.host}:${redis.port}/${redis.db}`,
  ].join("|");
  return createHash("sha256").update(id).digest("hex");
}

/** Gate A — pure, pre-connection. Throws E2eTargetError, else returns the validated targets. */
export function validateGateA(env: Env): GateAResult {
  for (const k of RETIRED_OVERRIDES) {
    if (env[k] !== undefined) failA("RETIRED_OVERRIDE", `${k} is retired and no longer authorizes any target; remove it and set TELVYN_E2E_PROFILE.`);
  }
  const name = env.TELVYN_E2E_PROFILE;
  if (name === undefined || name === "") failA("MISSING_PROFILE", "TELVYN_E2E_PROFILE must be set (local-isolated | local-verify | ci-ephemeral).");
  if (!Object.prototype.hasOwnProperty.call(E2E_PROFILES, name as string)) failA("INVALID_PROFILE", "TELVYN_E2E_PROFILE is not a known profile.");
  const profile = E2E_PROFILES[name as E2eProfileName];
  for (const [k, v] of Object.entries(profile.requireEnv)) {
    if (env[k] !== v) failA("PROFILE_PRECONDITION", `profile ${profile.name} requires ${k}=${v}.`);
  }
  const app = parsePg("DATABASE_URL", env.DATABASE_URL, profile.pg, profile.pg.appUser);
  const fixture = parsePg("E2E_FIXTURE_DATABASE_URL", env.E2E_FIXTURE_DATABASE_URL, profile.pg, profile.pg.fixtureUser);
  if (app.host !== fixture.host) failA("SPLIT_TARGET", "DATABASE_URL and E2E_FIXTURE_DATABASE_URL must name the same host.");
  const redis = parseRedis(env.REDIS_URL, profile.redis);
  return { profile, app, fixture, redis, fingerprint: fingerprintOf(profile.name, app, fixture, redis) };
}

// ---------------------------------------------------------------- Gate B ----

export interface PgIdentityRow {
  database: string;
  user: string;
  serverVersionNum: number;
  serverPort: number | null;
  postmasterStart: string;
  /** Effective value of the marker setting in this session (current_setting). */
  marker: string | null;
  /** Value stored at DATABASE level only (pg_db_role_setting, setrole = 0, this database). */
  dbMarker: string | null;
  /** True if the marker is also set anywhere other than this database's own default
   *  (a role-level, role-in-database, or cluster-wide default) — refused (M2). */
  markerOverride: boolean;
  /** Owner of the current database. */
  dbOwner: string;
  /** N1: the connected role is a member (direct or indirect, any option) of the
   *  database owner role, so it could act as the owner and write the marker. */
  ownerMember: boolean;
  isSuperuser: boolean;
  canCreateRole: boolean;
  canCreateDb: boolean;
  bypassRls: boolean;
  canCreateInDatabase: boolean;
  memberOfPrivileged: boolean;
}
export interface MigrationState {
  applied: string[];
  unfinished: number;
}
export interface RedisIdentity {
  marker: string | null;
  db: number;
}
/** Read-only probes. Implementations MUST NOT write. */
export interface GateBProbes {
  appIdentity(): Promise<PgIdentityRow>;
  fixtureIdentity(): Promise<PgIdentityRow>;
  migrationState(): Promise<MigrationState>;
  redisIdentity(): Promise<RedisIdentity>;
}
export interface GateBResult {
  serverPort: number | null;
  migrations: number;
}

async function probe<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return failB("IDENTITY_QUERY_FAILED", `${what} identity probe failed; refusing (no detail is echoed).`);
  }
}

/** The SQL the PostgreSQL probe runs (exported so tests can assert it is read-only). */
export const PG_IDENTITY_SQL = `SELECT current_database() AS database,
  current_user AS "user",
  current_setting('server_version_num')::int AS "serverVersionNum",
  inet_server_port() AS "serverPort",
  pg_postmaster_start_time()::text AS "postmasterStart",
  current_setting('${DB_MARKER_SETTING}', true) AS marker,
  (SELECT substr(c, strpos(c, '=') + 1)
     FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) AS c
    WHERE s.setrole = 0 AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND split_part(c, '=', 1) = '${DB_MARKER_SETTING}') AS "dbMarker",
  (EXISTS (SELECT 1 FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) AS c
            WHERE split_part(c, '=', 1) = '${DB_MARKER_SETTING}'
              AND NOT (s.setrole = 0 AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())))) AS "markerOverride",
  (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) AS "dbOwner",
  (SELECT pg_has_role(current_user, datdba, 'MEMBER') FROM pg_database WHERE datname = current_database()) AS "ownerMember",
  r.rolsuper AS "isSuperuser", r.rolcreaterole AS "canCreateRole", r.rolcreatedb AS "canCreateDb",
  r.rolbypassrls AS "bypassRls",
  has_database_privilege(current_database(), 'CREATE') AS "canCreateInDatabase",
  (EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname IN ('telvyn_migrator','telvyn_ledger_fn','telvyn_ledger_admin','telvyn')
           AND p.rolname <> current_user AND pg_has_role(current_user, p.oid, 'MEMBER'))) AS "memberOfPrivileged"
FROM pg_roles r WHERE r.rolname = current_user`;

export const MIGRATION_STATE_SQL = `SELECT migration_name AS name, (finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok
FROM "_prisma_migrations"`;

/**
 * Gate B — post-connection identity. `expectedMigrations` are the migration
 * directory names in the repository; every one must be applied and finished.
 */
export async function verifyGateB(a: GateAResult, probes: GateBProbes, expectedMigrations: readonly string[]): Promise<GateBResult> {
  const p = a.profile;
  const app = await probe("application database", () => probes.appIdentity());
  const fix = await probe("fixture database", () => probes.fixtureIdentity());

  for (const [label, row, user] of [
    ["application", app, p.pg.appUser],
    ["fixture", fix, p.pg.fixtureUser],
  ] as const) {
    if (row.database !== p.pg.database) failB("WRONG_DATABASE", `${label} connection reports an unexpected current_database().`);
    if (row.user !== user) failB("WRONG_ROLE", `${label} connection reports an unexpected current_user.`);
    if (!(row.serverVersionNum >= MIN_SERVER_VERSION_NUM)) failB("WRONG_SERVER", `${label} server is older than PostgreSQL 18.`);
    // M2: the marker must be a DATABASE-level default (settable only by the database
    // owner or a superuser), must not also exist at role / role-in-database / cluster
    // level (a role can set its own defaults), and the session's effective value must
    // equal it (no session/startup override).
    if (row.dbMarker !== p.dbMarker) failB(row.dbMarker ? "WRONG_DB_MARKER" : "MISSING_DB_MARKER", `${label} database does not carry the ${p.name} test-instance marker at database level.`);
    if (row.markerOverride) failB("MARKER_OVERRIDE", `the test-instance marker is also set at role or cluster level; refusing.`);
    if (row.marker !== row.dbMarker) failB("MARKER_OVERRIDE", `${label} session's effective marker differs from the database-level marker; refusing.`);
    if (row.dbOwner === p.pg.appUser || row.dbOwner === p.pg.fixtureUser) failB("MARKER_WRITABLE_BY_TEST_ROLE", "the target database is owned by a test role, which could write the marker; refusing.");
    // N1: membership in the owner role (SET/INHERIT, direct or indirect) is equivalent to ownership here.
    if (row.ownerMember) failB("MARKER_WRITABLE_BY_TEST_ROLE", `${label} role is a member of the database owner role, which could write the marker; refusing.`);
    if (row.isSuperuser) failB("PRIVILEGED_ROLE", `${label} role is a superuser.`);
  }
  if (app.postmasterStart !== fix.postmasterStart || app.serverPort !== fix.serverPort) {
    failB("SPLIT_SERVER", "application and fixture connections reached different servers.");
  }
  if (app.canCreateRole || app.canCreateDb || app.bypassRls || app.canCreateInDatabase || app.memberOfPrivileged) {
    failB("RUNTIME_ROLE_NOT_RESTRICTED", "the runtime role holds privileges the restricted telvyn_app must not have.");
  }

  const mig = await probe("migration state", () => probes.migrationState());
  if (mig.unfinished > 0) failB("MIGRATION_INCOMPLETE", "a migration is failed, rolled back or unfinished.");
  const applied = new Set(mig.applied);
  const missing = expectedMigrations.filter((m) => !applied.has(m));
  if (missing.length > 0) failB("MIGRATION_MISSING", `${missing.length} repository migration(s) are not applied on the target.`);

  const r = await probe("redis", () => probes.redisIdentity());
  if (r.db !== p.redis.db) failB("WRONG_REDIS_DB", "Redis connection is on an unexpected logical DB.");
  if (r.marker !== p.redisMarker) failB(r.marker ? "WRONG_REDIS_MARKER" : "MISSING_REDIS_MARKER", `Redis does not carry the ${p.name} test-instance marker.`);

  return { serverPort: app.serverPort, migrations: mig.applied.length };
}
