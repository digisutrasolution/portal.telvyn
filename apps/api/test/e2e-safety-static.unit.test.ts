/**
 * INC-DB-001B — static regression guard over the test sources and configs.
 * Fails if a future change reintroduces an unguarded default lane, a
 * shared-target fallback, an unscoped Redis/DB cleanup, or a guard bypass.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import unitConfig from "../vitest.config";
import e2eConfig from "../vitest.e2e.config";

const TEST_DIR = __dirname;
const e2eFiles = readdirSync(TEST_DIR).filter((f) => f.endsWith(".e2e.test.ts"));
const read = (f: string) => readFileSync(path.join(TEST_DIR, f), "utf8");
const pkg = JSON.parse(readFileSync(path.join(TEST_DIR, "../package.json"), "utf8")) as { scripts: Record<string, string> };

describe("default Vitest lane is unit-only", () => {
  it("vitest.config.ts never includes E2E files and loads the unit sentinel setup", () => {
    const t = unitConfig.test!;
    expect(t.include).toEqual(["src/**/*.test.ts", "test/**/*.unit.test.ts"]);
    expect(t.include!.some((g) => g.includes("e2e"))).toBe(false);
    expect(t.exclude).toContain("**/*.e2e.test.ts");
    expect(t.setupFiles).toEqual(["./test/setup-unit.ts"]);
    expect((t as { globalSetup?: unknown }).globalSetup).toBeUndefined();
  });

  it("vitest.e2e.config.ts runs Gate A+B in globalSetup and the worker guard in setupFiles", () => {
    const t = e2eConfig.test!;
    expect(t.include).toEqual(["test/**/*.e2e.test.ts"]);
    expect(t.globalSetup).toEqual(["./test/e2e-global-setup.ts"]);
    expect(t.setupFiles).toEqual(["./test/setup-e2e.ts"]);
  });

  it("package scripts: `test` is the unit lane, `test:e2e` the guarded lane", () => {
    expect(pkg.scripts.test).toBe("vitest run --config vitest.config.ts");
    expect(pkg.scripts["test:e2e"]).toBe("vitest run --config vitest.e2e.config.ts");
  });

  it("the unit setup pins unresolvable data-plane sentinels", () => {
    expect(process.env.DATABASE_URL).toMatch(/\.invalid:1\//);
    expect(process.env.REDIS_URL).toMatch(/\.invalid:1$/);
    expect(process.env.E2E_FIXTURE_DATABASE_URL).toBeUndefined();
    expect(process.env.TELVYN_E2E_PROFILE).toBeUndefined();
  });
});

describe("E2E sources", () => {
  it("found the E2E suite", () => {
    expect(e2eFiles.length).toBeGreaterThanOrEqual(30);
  });

  it.each(e2eFiles)("%s: guarded first import and no shared-target fallback", (f) => {
    const src = read(f);
    // The guard (directly, or via fixture-db) must be imported before any client
    // or app is constructed; setupFiles additionally runs it before the file loads.
    const guardAt = Math.max(src.indexOf('from "./fixture-db"'), src.indexOf('import "./e2e-guard"'));
    expect(guardAt).toBeGreaterThan(-1);
    const firstClient = src.search(/new (PrismaClient|PrismaService|Redis)\(|createApp\(/);
    if (firstClient > -1) expect(guardAt).toBeLessThan(firstClient);
    expect(src).not.toMatch(/process\.env\.(DATABASE_URL|REDIS_URL|E2E_FIXTURE_DATABASE_URL)\s*\?\?=/);
    expect(src).not.toMatch(/localhost:543[23]|localhost:638[01]|127\.0\.0\.1:543[23]|127\.0\.0\.1:638[01]/);
    expect(src).not.toMatch(/TELVYN_E2E_ALLOW_TARGET/);
  });

  it.each(e2eFiles)("%s: no unscoped Redis or database cleanup", (f) => {
    const src = read(f);
    expect(src).not.toMatch(/\bredis\.(keys|flushdb|flushall)\s*\(/i);
    expect(src).not.toMatch(/["'`](FLUSHDB|FLUSHALL)["'`]/i);
    expect(src).not.toMatch(/endsWith:\s*"@telvyn\.test"/);
    expect(src).not.toMatch(/killSwitch\.deleteMany\(\{\s*where:\s*\{\s*scope:\s*"GLOBAL"\s*\}\s*\}\)/);
    expect(src).not.toMatch(/tenant\.deleteMany\(\{\s*where:\s*\{\s*name:\s*(\{\s*in:|")/);
    expect(src).not.toMatch(/session_replication_role/i);
  });

  it("cleanup helpers never disable triggers, flush, or use KEYS", () => {
    const src = read("e2e-run.ts").replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, ""); // code only, not comments
    expect(src).not.toMatch(/DISABLE\s+TRIGGER|session_replication_role|\.flushdb\(|\.flushall\(|\.keys\(/i);
  });

  it("global setup takes the exclusive run lease after Gate B and releases it in teardown (M1)", () => {
    const src = read("e2e-global-setup.ts");
    const gateB = src.indexOf("verifyGateB(");
    const lease = src.indexOf("acquireRunLease(");
    const provide = src.indexOf('project.provide("telvynE2eFingerprint"');
    expect(gateB).toBeGreaterThan(-1);
    expect(lease).toBeGreaterThan(gateB);
    expect(provide).toBeGreaterThan(lease);
    expect(src).toMatch(/return async \(\) => \{\s*await lease\.release\(\);/);
  });

  it("N2: global setup publishes the lease session identity after acquiring the lease", () => {
    const src = read("e2e-global-setup.ts");
    expect(src.indexOf('project.provide("telvynE2eLease", lease.token)')).toBeGreaterThan(src.indexOf("acquireRunLease("));
    expect(src).toMatch(/application_name", LEASE_APPLICATION_NAME/);
  });

  it("N2: every worker joins the execution fence after the guard and holds it until its last hook", () => {
    const src = read("setup-e2e.ts");
    const guard = src.indexOf('import "./e2e-guard"');
    const fence = src.indexOf('from "./e2e-worker-fence"');
    expect(guard).toBeGreaterThan(-1);
    expect(fence).toBeGreaterThan(guard);
    expect(src).toMatch(/beforeAll\(async \(\) => \{\s*fence = await startWorkerFence\(\);/);
    // The fence hooks are registered before any other hook in the setup file.
    expect(src.indexOf("beforeAll(")).toBeLessThan(src.indexOf("afterAll("));
    expect(src).toMatch(/afterAll\(async \(\) => \{\s*await fence\?\.stop\(\);/);
    const w = read("e2e-worker-fence.ts");
    expect(w.indexOf('from "./e2e-guard"')).toBeLessThan(w.indexOf("new PrismaClient"));
    expect(w).toMatch(/process\.env\.E2E_FIXTURE_DATABASE_URL/);
    expect(w).not.toMatch(/process\.env\.DATABASE_URL/);
    expect(w).toMatch(/process\.once\("disconnect"/);
    // Vitest stubs process.exit inside workers (it only throws), so the worker path must SIGKILL itself.
    expect(w).not.toMatch(/process\.exit\(/);
    const lease = read("e2e-run-lease.ts");
    expect(lease).toMatch(/process\.kill\(process\.pid, "SIGKILL"\)/);
    expect(lease).toMatch(/const defaultWorkerLost = \(reason: string\): void => \{\s*terminateWorkerNow\(/);
    // The main (global-setup) process is not stubbed: it exits non-zero on lease loss.
    expect(lease).toMatch(/const defaultMainLost[\s\S]*?process\.exit\(1\)/);
  });

  it("N2: the E2E lane runs files in child processes (forks) so a worker can be terminated", () => {
    expect((e2eConfig.test as { pool?: string }).pool).toBe("forks");
  });

  it("N2: the lease drill only runs in the disposable local-verify profile, on explicit request", () => {
    const src = read("e2e-lease-drill.e2e.test.ts");
    expect(src).toMatch(/E2E_TARGET\.profile\.name === "local-verify" && \(MODE === "loss" \|\| MODE === "setup-fail"\)/);
    expect(src).toMatch(/describe\.skipIf\(!ENABLED\)/);
    expect(src).not.toMatch(/pg_terminate_backend/);
  });

  it("fixture-db constructs its client only after the guard, from the fixture URL only", () => {
    const src = read("fixture-db.ts");
    expect(src.indexOf('from "./e2e-guard"')).toBeGreaterThan(-1);
    expect(src.indexOf('from "./e2e-guard"')).toBeLessThan(src.indexOf("new PrismaClient"));
    expect(src).not.toMatch(/new PrismaClient\(\)/);
    expect(src).not.toMatch(/\?\?\s*process\.env\.DATABASE_URL/);
  });
});
