/**
 * INC-DB-001B — negative/positive tests for the two-stage E2E target guard.
 * Pure: Gate A is exercised on synthetic env objects and Gate B on mocked
 * probes. Nothing here opens a socket; the URLs below are never connected to.
 */
import { describe, expect, it, vi } from "vitest";
import {
  E2E_PROFILES,
  E2eTargetError,
  MIGRATION_STATE_SQL,
  PG_IDENTITY_SQL,
  type GateBProbes,
  type PgIdentityRow,
  validateGateA,
  verifyGateB,
} from "./e2e-target-guard";

const pg = (user: string, hostPort = "127.0.0.1:5434", db = "telvyn_ledger_e2e") => `postgresql://${user}:pw@${hostPort}/${db}`;
const LOCAL = {
  TELVYN_E2E_PROFILE: "local-isolated",
  DATABASE_URL: pg("telvyn_app"),
  E2E_FIXTURE_DATABASE_URL: pg("telvyn_migrator"),
  REDIS_URL: "redis://127.0.0.1:6381",
};
const CI = {
  TELVYN_E2E_PROFILE: "ci-ephemeral",
  GITHUB_ACTIONS: "true",
  CI: "true",
  DATABASE_URL: pg("telvyn_app", "localhost:55432", "telvyn"),
  E2E_FIXTURE_DATABASE_URL: pg("telvyn_migrator", "localhost:55432", "telvyn"),
  REDIS_URL: "redis://localhost:56379",
};
const VERIFY = {
  TELVYN_E2E_PROFILE: "local-verify",
  DATABASE_URL: pg("telvyn_app", "127.0.0.1:5435", "telvyn_safety_verify"),
  E2E_FIXTURE_DATABASE_URL: pg("telvyn_migrator", "127.0.0.1:5435", "telvyn_safety_verify"),
  REDIS_URL: "redis://127.0.0.1:6382/0",
};

function codeA(env: Record<string, string | undefined>): string {
  try {
    validateGateA(env);
  } catch (e) {
    expect(e).toBeInstanceOf(E2eTargetError);
    expect((e as E2eTargetError).gate).toBe("A");
    // Diagnostics never echo credentials or raw URLs.
    expect((e as Error).message).not.toContain("pw");
    expect((e as Error).message).not.toMatch(/postgres(ql)?:\/\/|redis:\/\//);
    return (e as E2eTargetError).code;
  }
  return "PASSED";
}

describe("Gate A — pre-connection (pure)", () => {
  it("accepts the local isolated profile and the CI ephemeral profile", () => {
    expect(codeA(LOCAL)).toBe("PASSED");
    expect(codeA(CI)).toBe("PASSED");
    expect(codeA({ ...LOCAL, REDIS_URL: "redis://127.0.0.1:6381/0" })).toBe("PASSED");
    expect(codeA({ ...LOCAL, DATABASE_URL: `${LOCAL.DATABASE_URL}?schema=public` })).toBe("PASSED");
  });

  it.each([
    ["native PG 5432", { DATABASE_URL: pg("telvyn_app", "127.0.0.1:5432") }],
    ["FMC PG 5433", { DATABASE_URL: pg("telvyn_app", "127.0.0.1:5433") }],
    ["fixture on 5432", { E2E_FIXTURE_DATABASE_URL: pg("telvyn_migrator", "127.0.0.1:5432") }],
    ["native Redis 6379", { REDIS_URL: "redis://127.0.0.1:6379" }],
    ["FMC Redis 6380", { REDIS_URL: "redis://127.0.0.1:6380" }],
  ])("refuses a protected port in every profile: %s", (_l, over) => {
    expect(codeA({ ...LOCAL, ...over })).toBe("PROTECTED_PORT");
    // The CI profile cannot authorize a protected native port either.
    const ciOver = Object.fromEntries(Object.entries(over).map(([k, v]) => [k, v.replace("127.0.0.1", "localhost")]));
    expect(codeA({ ...CI, ...ciOver })).toBe("PROTECTED_PORT");
  });

  it("refuses the wrong database, an unexpected role, and a remote host", () => {
    expect(codeA({ ...LOCAL, DATABASE_URL: pg("telvyn_app", "127.0.0.1:5434", "telvyn_ledger_dev") })).toBe("DATABASE_NOT_ALLOWED");
    expect(codeA({ ...LOCAL, DATABASE_URL: pg("telvyn_app", "127.0.0.1:5434", "telvyn") })).toBe("DATABASE_NOT_ALLOWED");
    expect(codeA({ ...LOCAL, DATABASE_URL: pg("telvyn_migrator") })).toBe("ROLE_NOT_ALLOWED");
    expect(codeA({ ...LOCAL, DATABASE_URL: pg("telvyn_ledger_admin") })).toBe("ROLE_NOT_ALLOWED");
    expect(codeA({ ...LOCAL, E2E_FIXTURE_DATABASE_URL: pg("telvyn_app") })).toBe("ROLE_NOT_ALLOWED");
    expect(codeA({ ...LOCAL, DATABASE_URL: pg("telvyn_app", "db.example.com:5434") })).toBe("HOST_NOT_ALLOWED");
    expect(codeA({ ...LOCAL, DATABASE_URL: pg("telvyn_app", "localhost:5434") })).toBe("HOST_NOT_ALLOWED");
    expect(codeA({ ...LOCAL, REDIS_URL: "redis://10.0.0.5:6381" })).toBe("HOST_NOT_ALLOWED");
    expect(codeA({ ...LOCAL, DATABASE_URL: pg("telvyn_app", "127.0.0.1:55432") })).toBe("PORT_NOT_ALLOWED");
  });

  it("refuses a missing, empty or malformed URL and a missing port", () => {
    expect(codeA({ ...LOCAL, DATABASE_URL: undefined })).toBe("MISSING_URL");
    expect(codeA({ ...LOCAL, DATABASE_URL: "" })).toBe("MISSING_URL");
    expect(codeA({ ...LOCAL, E2E_FIXTURE_DATABASE_URL: undefined })).toBe("MISSING_URL");
    expect(codeA({ ...LOCAL, REDIS_URL: undefined })).toBe("MISSING_URL");
    expect(codeA({ ...LOCAL, DATABASE_URL: "not a url" })).toBe("MALFORMED_URL");
    expect(codeA({ ...LOCAL, DATABASE_URL: "postgresql://telvyn_app:pw@127.0.0.1/telvyn_ledger_e2e" })).toBe("MISSING_PORT");
    expect(codeA({ ...LOCAL, DATABASE_URL: "mysql://telvyn_app:pw@127.0.0.1:5434/telvyn_ledger_e2e" })).toBe("BAD_PROTOCOL");
    expect(codeA({ ...LOCAL, REDIS_URL: "rediss://127.0.0.1:6381" })).toBe("BAD_PROTOCOL");
    expect(codeA({ ...LOCAL, DATABASE_URL: `${LOCAL.DATABASE_URL}?host=/tmp` })).toBe("BAD_QUERY");
  });

  it("refuses an unexpected Redis logical DB", () => {
    expect(codeA({ ...LOCAL, REDIS_URL: "redis://127.0.0.1:6381/3" })).toBe("REDIS_DB_NOT_ALLOWED");
    expect(codeA({ ...LOCAL, REDIS_URL: "redis://127.0.0.1:6381/x" })).toBe("BAD_REDIS_DB");
  });

  it("refuses a .env-only configuration: nothing in process.env means no target", () => {
    // Gate A reads only the explicitly supplied environment; values that exist
    // only in apps/api/.env are never loaded before it runs.
    expect(codeA({})).toBe("MISSING_PROFILE");
    expect(codeA({ TELVYN_E2E_PROFILE: "local-isolated" })).toBe("MISSING_URL");
  });

  it("refuses a missing or invalid profile", () => {
    expect(codeA({ ...LOCAL, TELVYN_E2E_PROFILE: undefined })).toBe("MISSING_PROFILE");
    expect(codeA({ ...LOCAL, TELVYN_E2E_PROFILE: "production" })).toBe("INVALID_PROFILE");
    expect(codeA({ ...LOCAL, TELVYN_E2E_PROFILE: "__proto__" })).toBe("INVALID_PROFILE");
  });

  it("refuses the retired single-flag override and an unapproved CI profile", () => {
    expect(codeA({ ...LOCAL, TELVYN_E2E_ALLOW_TARGET: "1" })).toBe("RETIRED_OVERRIDE");
    expect(codeA({ ...CI, TELVYN_E2E_ALLOW_TARGET: "1" })).toBe("RETIRED_OVERRIDE");
    // CI profile without the GitHub Actions runtime, or with only CI=true.
    expect(codeA({ ...CI, GITHUB_ACTIONS: undefined })).toBe("PROFILE_PRECONDITION");
    expect(codeA({ ...CI, CI: undefined })).toBe("PROFILE_PRECONDITION");
    // A locally supplied CI flag cannot point the CI profile at the native database.
    expect(codeA({ ...CI, DATABASE_URL: pg("telvyn_app", "localhost:5432", "telvyn") })).toBe("PROTECTED_PORT");
    // CI profile against the local isolated ports is also not its allowlist.
    expect(codeA({ ...CI, DATABASE_URL: pg("telvyn_app", "localhost:5434", "telvyn") })).toBe("PORT_NOT_ALLOWED");
  });

  it("L1: refuses a URL fragment and a repeated query parameter", () => {
    expect(codeA({ ...LOCAL, DATABASE_URL: `${LOCAL.DATABASE_URL}#x` })).toBe("BAD_QUERY");
    expect(codeA({ ...LOCAL, E2E_FIXTURE_DATABASE_URL: `${LOCAL.E2E_FIXTURE_DATABASE_URL}?schema=public#frag` })).toBe("BAD_QUERY");
    expect(codeA({ ...LOCAL, DATABASE_URL: `${LOCAL.DATABASE_URL}?schema=public&schema=other` })).toBe("BAD_QUERY");
    expect(codeA({ ...LOCAL, REDIS_URL: "redis://127.0.0.1:6381/0#x" })).toBe("BAD_QUERY");
    expect(codeA({ ...VERIFY, DATABASE_URL: `${VERIFY.DATABASE_URL}#x` })).toBe("BAD_QUERY");
  });

  it("local-verify: accepts exactly its fixed targets", () => {
    expect(codeA(VERIFY)).toBe("PASSED");
    const a = validateGateA(VERIFY);
    expect(a.profile.name).toBe("local-verify");
    expect(a.fingerprint).not.toBe(validateGateA(LOCAL).fingerprint);
    expect(E2E_PROFILES["local-verify"].dbMarker).toBe("telvyn-inc-db-001b-local-verify");
    expect(E2E_PROFILES["local-verify"].requireEnv).toEqual({});
  });

  it.each([
    ["missing profile", { TELVYN_E2E_PROFILE: undefined }, "MISSING_PROFILE"],
    ["missing app URL", { DATABASE_URL: undefined }, "MISSING_URL"],
    ["missing fixture URL", { E2E_FIXTURE_DATABASE_URL: undefined }, "MISSING_URL"],
    ["missing Redis URL", { REDIS_URL: undefined }, "MISSING_URL"],
    ["wrong host (localhost)", { DATABASE_URL: pg("telvyn_app", "localhost:5435", "telvyn_safety_verify") }, "HOST_NOT_ALLOWED"],
    ["wrong host (remote)", { E2E_FIXTURE_DATABASE_URL: pg("telvyn_migrator", "10.0.0.5:5435", "telvyn_safety_verify") }, "HOST_NOT_ALLOWED"],
    ["wrong port (existing TELVYN 5434)", { DATABASE_URL: pg("telvyn_app", "127.0.0.1:5434", "telvyn_safety_verify") }, "PORT_NOT_ALLOWED"],
    ["protected port 5432", { DATABASE_URL: pg("telvyn_app", "127.0.0.1:5432", "telvyn_safety_verify") }, "PROTECTED_PORT"],
    ["protected port 5433", { E2E_FIXTURE_DATABASE_URL: pg("telvyn_migrator", "127.0.0.1:5433", "telvyn_safety_verify") }, "PROTECTED_PORT"],
    ["wrong DB (isolated e2e)", { DATABASE_URL: pg("telvyn_app", "127.0.0.1:5435", "telvyn_ledger_e2e") }, "DATABASE_NOT_ALLOWED"],
    ["wrong DB (prefix wildcard)", { DATABASE_URL: pg("telvyn_app", "127.0.0.1:5435", "telvyn_safety_verify2") }, "DATABASE_NOT_ALLOWED"],
    ["wrong runtime role", { DATABASE_URL: pg("telvyn_migrator", "127.0.0.1:5435", "telvyn_safety_verify") }, "ROLE_NOT_ALLOWED"],
    ["admin as runtime role", { DATABASE_URL: pg("telvyn", "127.0.0.1:5435", "telvyn_safety_verify") }, "ROLE_NOT_ALLOWED"],
    ["wrong fixture role", { E2E_FIXTURE_DATABASE_URL: pg("telvyn_app", "127.0.0.1:5435", "telvyn_safety_verify") }, "ROLE_NOT_ALLOWED"],
    ["wrong Redis port (existing TELVYN 6381)", { REDIS_URL: "redis://127.0.0.1:6381/0" }, "PORT_NOT_ALLOWED"],
    ["protected Redis 6379", { REDIS_URL: "redis://127.0.0.1:6379/0" }, "PROTECTED_PORT"],
    ["protected Redis 6380", { REDIS_URL: "redis://127.0.0.1:6380/0" }, "PROTECTED_PORT"],
    ["wrong Redis host", { REDIS_URL: "redis://localhost:6382/0" }, "HOST_NOT_ALLOWED"],
    ["wrong Redis DB", { REDIS_URL: "redis://127.0.0.1:6382/1" }, "REDIS_DB_NOT_ALLOWED"],
    ["invalid query", { DATABASE_URL: `${VERIFY.DATABASE_URL}?host=/tmp` }, "BAD_QUERY"],
    ["retired override", { TELVYN_E2E_ALLOW_TARGET: "1" }, "RETIRED_OVERRIDE"],
  ])("local-verify refuses: %s", (_l, over, expected) => {
    expect(codeA({ ...VERIFY, ...over })).toBe(expected);
  });

  it("wrong profile/target combinations are refused (no automatic profile selection)", () => {
    expect(codeA({ ...VERIFY, TELVYN_E2E_PROFILE: "local-isolated" })).toBe("PORT_NOT_ALLOWED");
    expect(codeA({ ...LOCAL, TELVYN_E2E_PROFILE: "local-verify" })).toBe("PORT_NOT_ALLOWED");
    expect(codeA({ ...VERIFY, TELVYN_E2E_PROFILE: "ci-ephemeral", GITHUB_ACTIONS: "true", CI: "true" })).toBe("PORT_NOT_ALLOWED");
  });

  it("fingerprint is credential-free and changes with the target", () => {
    const a = validateGateA(LOCAL);
    const b = validateGateA({ ...LOCAL, DATABASE_URL: pg("telvyn_app").replace(":pw@", ":other@") });
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(b.fingerprint).toBe(a.fingerprint); // password is not part of identity
    expect(validateGateA(CI).fingerprint).not.toBe(a.fingerprint);
  });
});

// ------------------------------------------------------------------ Gate B --

const profile = E2E_PROFILES["local-isolated"];
const MIGRATIONS = ["20260101000000_init", "20261127090000_financial_authz_foundation"];
const row = (over: Partial<PgIdentityRow> = {}): PgIdentityRow => ({
  database: "telvyn_ledger_e2e",
  user: "telvyn_app",
  serverVersionNum: 180001,
  serverPort: 5432, // container port — deliberately NOT the published 5434
  postmasterStart: "2026-11-27 10:00:00+00",
  marker: profile.dbMarker,
  dbMarker: profile.dbMarker,
  markerOverride: false,
  dbOwner: "telvyn_ledger_admin",
  ownerMember: false,
  isSuperuser: false,
  canCreateRole: false,
  canCreateDb: false,
  bypassRls: false,
  canCreateInDatabase: false,
  memberOfPrivileged: false,
  ...over,
});
function probes(over: Partial<{ app: Partial<PgIdentityRow>; fix: Partial<PgIdentityRow>; mig: { applied: string[]; unfinished: number }; redis: { marker: string | null; db: number } }> = {}) {
  const p = {
    appIdentity: vi.fn(async () => row(over.app)),
    fixtureIdentity: vi.fn(async () => row({ user: "telvyn_migrator", ...over.fix })),
    migrationState: vi.fn(async () => over.mig ?? { applied: [...MIGRATIONS], unfinished: 0 }),
    redisIdentity: vi.fn(async () => over.redis ?? { marker: profile.redisMarker, db: 0 }),
  } satisfies GateBProbes;
  return p;
}
async function codeB(p: GateBProbes): Promise<string> {
  try {
    await verifyGateB(validateGateA(LOCAL), p, MIGRATIONS);
  } catch (e) {
    expect(e).toBeInstanceOf(E2eTargetError);
    expect((e as E2eTargetError).gate).toBe("B");
    return (e as E2eTargetError).code;
  }
  return "PASSED";
}

describe("Gate B — post-connection identity (mocked probes)", () => {
  it("passes on the marked isolated instance, without requiring server port == published port", async () => {
    const p = probes();
    await expect(verifyGateB(validateGateA(LOCAL), p, MIGRATIONS)).resolves.toEqual({ serverPort: 5432, migrations: 2 });
  });

  it("refuses a missing or wrong database marker", async () => {
    expect(await codeB(probes({ app: { marker: null, dbMarker: null } }))).toBe("MISSING_DB_MARKER");
    expect(await codeB(probes({ fix: { marker: "telvyn-e2e/ci-ephemeral", dbMarker: "telvyn-e2e/ci-ephemeral" } }))).toBe("WRONG_DB_MARKER");
  });

  it("M2: refuses a marker that exists only at role/session level (forgeable by a test role)", async () => {
    // Effective value correct, but no database-level default: e.g. ALTER ROLE <self> SET ...
    expect(await codeB(probes({ app: { dbMarker: null } }))).toBe("MISSING_DB_MARKER");
    // Database-level marker present, but an additional role-level/cluster-level copy exists.
    expect(await codeB(probes({ app: { markerOverride: true } }))).toBe("MARKER_OVERRIDE");
    // Session's effective value differs from the database-level value (startup/session override).
    expect(await codeB(probes({ fix: { marker: "something-else" } }))).toBe("MARKER_OVERRIDE");
  });

  it("M2: refuses a database owned by the runtime or fixture role (it could write the marker)", async () => {
    expect(await codeB(probes({ app: { dbOwner: "telvyn_app" } }))).toBe("MARKER_WRITABLE_BY_TEST_ROLE");
    expect(await codeB(probes({ fix: { dbOwner: "telvyn_migrator" } }))).toBe("MARKER_WRITABLE_BY_TEST_ROLE");
  });

  it("N1: refuses when a test role is a member of the database owner role (it could assume ownership)", async () => {
    expect(await codeB(probes({ app: { ownerMember: true } }))).toBe("MARKER_WRITABLE_BY_TEST_ROLE");
    expect(await codeB(probes({ fix: { ownerMember: true } }))).toBe("MARKER_WRITABLE_BY_TEST_ROLE");
  });

  it("N1: identity SQL inspects inherited/SET membership in the database owner", () => {
    expect(PG_IDENTITY_SQL).toMatch(/pg_has_role\(current_user, datdba, 'MEMBER'\)/);
  });

  it("local-verify: passes on its marked instance and refuses role/session marker overrides and a wrong Redis marker", async () => {
    const v = E2E_PROFILES["local-verify"];
    const vrow = (o: Partial<PgIdentityRow> = {}) => row({ database: "telvyn_safety_verify", marker: v.dbMarker, dbMarker: v.dbMarker, dbOwner: "telvyn", ...o });
    const vp = (o: { app?: Partial<PgIdentityRow>; fix?: Partial<PgIdentityRow>; redis?: { marker: string | null; db: number } } = {}) =>
      ({
        appIdentity: vi.fn(async () => vrow(o.app)),
        fixtureIdentity: vi.fn(async () => vrow({ user: "telvyn_migrator", ...o.fix })),
        migrationState: vi.fn(async () => ({ applied: [...MIGRATIONS], unfinished: 0 })),
        redisIdentity: vi.fn(async () => o.redis ?? { marker: v.redisMarker, db: 0 }),
      }) satisfies GateBProbes;
    const codeV = async (p: GateBProbes) => {
      try {
        await verifyGateB(validateGateA(VERIFY), p, MIGRATIONS);
      } catch (e) {
        return (e as E2eTargetError).code;
      }
      return "PASSED";
    };
    expect(await codeV(vp())).toBe("PASSED");
    expect(await codeV(vp({ app: { marker: null, dbMarker: null } }))).toBe("MISSING_DB_MARKER");
    expect(await codeV(vp({ app: { marker: profile.dbMarker, dbMarker: profile.dbMarker } }))).toBe("WRONG_DB_MARKER");
    expect(await codeV(vp({ fix: { markerOverride: true } }))).toBe("MARKER_OVERRIDE");
    expect(await codeV(vp({ app: { marker: "forged" } }))).toBe("MARKER_OVERRIDE");
    expect(await codeV(vp({ app: { dbOwner: "telvyn_migrator" } }))).toBe("MARKER_WRITABLE_BY_TEST_ROLE");
    expect(await codeV(vp({ fix: { ownerMember: true } }))).toBe("MARKER_WRITABLE_BY_TEST_ROLE");
    expect(await codeV(vp({ redis: { marker: null, db: 0 } }))).toBe("MISSING_REDIS_MARKER");
    expect(await codeV(vp({ redis: { marker: profile.redisMarker, db: 0 } }))).toBe("WRONG_REDIS_MARKER");
    expect(await codeV(vp({ app: { database: "telvyn_ledger_e2e" } }))).toBe("WRONG_DATABASE");
  });

  it("refuses a missing or wrong Redis marker and the wrong Redis DB", async () => {
    expect(await codeB(probes({ redis: { marker: null, db: 0 } }))).toBe("MISSING_REDIS_MARKER");
    expect(await codeB(probes({ redis: { marker: "something-else", db: 0 } }))).toBe("WRONG_REDIS_MARKER");
    expect(await codeB(probes({ redis: { marker: profile.redisMarker, db: 1 } }))).toBe("WRONG_REDIS_DB");
  });

  it("refuses the wrong current_database() and the wrong current_user", async () => {
    expect(await codeB(probes({ app: { database: "telvyn" } }))).toBe("WRONG_DATABASE");
    expect(await codeB(probes({ app: { user: "telvyn" } }))).toBe("WRONG_ROLE");
    expect(await codeB(probes({ fix: { user: "telvyn_app" } }))).toBe("WRONG_ROLE");
  });

  it("refuses a non-restricted runtime role and a superuser fixture role", async () => {
    expect(await codeB(probes({ app: { isSuperuser: true } }))).toBe("PRIVILEGED_ROLE");
    expect(await codeB(probes({ fix: { isSuperuser: true } }))).toBe("PRIVILEGED_ROLE");
    for (const k of ["canCreateRole", "canCreateDb", "bypassRls", "canCreateInDatabase", "memberOfPrivileged"] as const) {
      expect(await codeB(probes({ app: { [k]: true } }))).toBe("RUNTIME_ROLE_NOT_RESTRICTED");
    }
  });

  it("refuses an old server (native PG 17), split servers, and incomplete migrations", async () => {
    expect(await codeB(probes({ app: { serverVersionNum: 170010 } }))).toBe("WRONG_SERVER");
    expect(await codeB(probes({ fix: { postmasterStart: "other" } }))).toBe("SPLIT_SERVER");
    expect(await codeB(probes({ mig: { applied: [MIGRATIONS[0]], unfinished: 0 } }))).toBe("MIGRATION_MISSING");
    expect(await codeB(probes({ mig: { applied: [...MIGRATIONS], unfinished: 1 } }))).toBe("MIGRATION_INCOMPLETE");
  });

  it("refuses a failed identity query without echoing the error", async () => {
    const p = probes();
    p.appIdentity.mockRejectedValueOnce(new Error("connect ECONNREFUSED secret-host:5434 password=hunter2"));
    let msg = "";
    try {
      await verifyGateB(validateGateA(LOCAL), p, MIGRATIONS);
    } catch (e) {
      msg = (e as Error).message;
      expect((e as E2eTargetError).code).toBe("IDENTITY_QUERY_FAILED");
    }
    expect(msg).not.toMatch(/hunter2|secret-host/);
    const r = probes();
    r.redisIdentity.mockRejectedValueOnce(new Error("boom"));
    expect(await codeB(r)).toBe("IDENTITY_QUERY_FAILED");
  });

  it("stops at the first rejection: no later probe runs after a failed identity check", async () => {
    const p = probes({ app: { marker: null, dbMarker: null } });
    await codeB(p);
    expect(p.migrationState).not.toHaveBeenCalled();
    expect(p.redisIdentity).not.toHaveBeenCalled();
  });

  it("probe SQL is read-only", () => {
    for (const sql of [PG_IDENTITY_SQL, MIGRATION_STATE_SQL]) {
      expect(sql.trim()).toMatch(/^SELECT\b/i);
      const code = sql.replace(/'[^']*'/g, "''"); // ignore string literals such as the 'CREATE' privilege name
      expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|SET\s+ROLE|COPY)\b/i);
    }
  });
});
