/**
 * Exclusive E2E run lease + worker execution fence — INC-DB-001B-R finding M1,
 * hardened for INC-DB-001B-PRE2 finding N2 (lease loss must stop the workers).
 *
 * Why exclusive: the disposable E2E instance holds state that is shared by design and
 * cannot be made run-owned (the GLOBAL kill-switch singleton, loopback rate-limit
 * windows). Two runs against one instance would interfere, so the instance is
 * EXCLUSIVE to one run at a time.
 *
 * Two PostgreSQL advisory-lock keys in the verified E2E database (advisory keys are
 * scoped to one database):
 *
 *   LEASE (class "TELV", object 1) — EXCLUSIVE, held for the whole run by ONE pinned
 *     session of the main (global-setup) process.
 *   FENCE (class "TELV", object 2) — SHARED, held by every test-worker process for its
 *     whole life on its own pinned session (test/e2e-worker-fence.ts).
 *
 * Acquisition (main process, after Gate B, before any test file is collected):
 *   1. pg_try_advisory_lock(LEASE)  — held elsewhere → INSTANCE_BUSY.
 *   2. pg_try_advisory_lock(FENCE)  — a live worker of an earlier run still holds it
 *      shared → INSTANCE_BUSY (that run is not fully stopped). Released immediately.
 *   3. wait DRAIN_GRACE_MS and repeat step 2. The grace covers a worker whose fence
 *      session was cut and therefore no longer shows a lock: such a worker detects the
 *      loss and terminates itself within WORKER_HEARTBEAT_MS + WORKER_STALE_MS, which
 *      is below DRAIN_GRACE_MS (assuming its event loop is responsive).
 *   4. publish the lease identity (backend pid + backend_start) to the workers.
 *
 * Loss handling (fail closed; a lost lease never yields a successful run):
 *   - main: a heartbeat confirms the LEASE is still held by the same session; if not,
 *     or if a check fails or stalls past the stale limit, the main process exits
 *     non-zero — no further test files are scheduled.
 *   - every worker: a heartbeat confirms (a) the LEASE is held by exactly the published
 *     session and (b) its own FENCE is held; on failure or stall the worker SIGKILLs
 *     itself (terminateWorkerNow — Vitest stubs process.exit in workers), so no test
 *     body, hook or afterAll cleanup of the interrupted file runs. A worker also
 *     terminates if its IPC channel to the main process disconnects.
 *
 * Bounds — this is NOT instantaneous and NOT atomic across PostgreSQL and Redis:
 * detection takes up to one heartbeat interval plus one in-flight check; a statement
 * or Redis command already sent may still complete server-side; a worker whose event
 * loop is blocked cannot react until it yields. A later run cannot pass steps 2–3
 * while any worker of this run still holds its fence session.
 *
 * This is an interlock between cooperating test runs against a disposable instance, not
 * a defence against an operator who deliberately bypasses the harness.
 */
import { writeSync } from "node:fs";
import { E2eTargetError } from "./e2e-target-guard";

/** Two-int4 advisory-lock keys: class "TELV" (0x54454C56); object 1 = run lease, 2 = worker fence. */
export const RUN_LEASE_CLASS = 0x54454c56;
export const RUN_LEASE_OBJECT = 1;
export const WORKER_FENCE_OBJECT = 2;

/** Timing (milliseconds). DRAIN_GRACE_MS must exceed WORKER_HEARTBEAT_MS + WORKER_STALE_MS. */
export const LEASE_HEARTBEAT_MS = 1_000;
export const LEASE_STALE_MS = 3_000;
export const WORKER_HEARTBEAT_MS = 1_000;
export const WORKER_STALE_MS = 3_000;
export const DRAIN_GRACE_MS = 5_000;

const THIS_DB = "(SELECT oid FROM pg_database WHERE datname = current_database())";

export const LEASE_TRY_SQL = `SELECT pg_try_advisory_lock(${RUN_LEASE_CLASS}, ${RUN_LEASE_OBJECT}) AS ok`;
export const LEASE_HELD_SQL = `SELECT EXISTS (SELECT 1 FROM pg_locks
  WHERE locktype = 'advisory' AND database = ${THIS_DB} AND classid = ${RUN_LEASE_CLASS}::oid
    AND objid = ${RUN_LEASE_OBJECT}::oid AND objsubid = 2 AND granted AND mode = 'ExclusiveLock'
    AND pid = pg_backend_pid()) AS held`;
export const LEASE_UNLOCK_SQL = `SELECT pg_advisory_unlock(${RUN_LEASE_CLASS}, ${RUN_LEASE_OBJECT}) AS ok`;
/** Identity of the lease session: pid + backend start time (guards against pid reuse). */
export const LEASE_IDENTITY_SQL = `SELECT pg_backend_pid() AS pid, backend_start::text AS started
  FROM pg_stat_activity WHERE pid = pg_backend_pid()`;
export const FENCE_DRAIN_TRY_SQL = `SELECT pg_try_advisory_lock(${RUN_LEASE_CLASS}, ${WORKER_FENCE_OBJECT}) AS ok`;
export const FENCE_DRAIN_UNLOCK_SQL = `SELECT pg_advisory_unlock(${RUN_LEASE_CLASS}, ${WORKER_FENCE_OBJECT}) AS ok`;
export const FENCE_SHARED_TRY_SQL = `SELECT pg_try_advisory_lock_shared(${RUN_LEASE_CLASS}, ${WORKER_FENCE_OBJECT}) AS ok`;
/** Worker check. Parameters: $1 = lease backend pid, $2 = lease backend_start (text). */
export const FENCE_CHECK_SQL = `SELECT
  EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.locktype = 'advisory' AND l.database = ${THIS_DB} AND l.classid = ${RUN_LEASE_CLASS}::oid
      AND l.objid = ${RUN_LEASE_OBJECT}::oid AND l.objsubid = 2 AND l.granted AND l.mode = 'ExclusiveLock'
      AND l.pid = $1::int AND a.backend_start::text = $2::text) AS "leaseOk",
  EXISTS (SELECT 1 FROM pg_locks
    WHERE locktype = 'advisory' AND database = ${THIS_DB} AND classid = ${RUN_LEASE_CLASS}::oid
      AND objid = ${WORKER_FENCE_OBJECT}::oid AND objsubid = 2 AND granted AND mode = 'ShareLock'
      AND pid = pg_backend_pid()) AS "fenceOk"`;

export interface LeaseIdentity {
  pid: number;
  started: string;
}
export const encodeLeaseToken = (id: LeaseIdentity): string => `${id.pid}@${id.started}`;
export function decodeLeaseToken(token: string | undefined): LeaseIdentity | null {
  const m = /^([1-9]\d{0,9})@(.{1,64})$/.exec(token ?? "");
  return m ? { pid: Number(m[1]), started: m[2] } : null;
}

/** Driver over ONE pinned database session of the main process. Never writes data. */
export interface LeaseDriver {
  tryLock(): Promise<boolean>;
  stillHeld(): Promise<boolean>;
  unlock(): Promise<void>;
  identity(): Promise<LeaseIdentity>;
  drainTry(): Promise<boolean>;
  drainUnlock(): Promise<void>;
  close(): Promise<void>;
}

export interface RunLease {
  /** Credential-free lease-session identity handed to the workers. */
  token: string;
  release(): Promise<void>;
}

export interface LeaseOptions {
  heartbeatMs?: number;
  staleMs?: number;
  drainGraceMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called once if the lease is lost mid-run. Default: exit the main process non-zero. */
  onLost?: (reason: string) => void;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const defaultMainLost = (reason: string): void => {
  console.error(`[e2e-run-lease] exclusive run lease LOST (${reason}); aborting the E2E run (fail closed).`);
  process.exit(1);
};

/**
 * Periodic check with a stall watchdog. Calls onFail exactly once if check() resolves
 * false, rejects, or no check has succeeded for longer than staleMs.
 */
export function watch(
  check: () => Promise<boolean>,
  onFail: (reason: string) => void,
  intervalMs: number,
  staleMs: number,
): { stop(): void } {
  let done = false;
  let inFlight = false;
  let lastOk = Date.now();
  const fail = (reason: string) => {
    if (done) return;
    done = true;
    clearInterval(timer);
    onFail(reason);
  };
  const timer = setInterval(() => {
    if (done) return;
    if (Date.now() - lastOk > staleMs) return fail("heartbeat stalled");
    if (inFlight) return;
    inFlight = true;
    check().then(
      (ok) => {
        inFlight = false;
        if (ok) lastOk = Date.now();
        else fail("lock not held by this run");
      },
      () => {
        inFlight = false;
        fail("heartbeat query failed");
      },
    );
  }, intervalMs);
  timer.unref?.();
  return {
    stop() {
      done = true;
      clearInterval(timer);
    },
  };
}

export async function acquireRunLease(driver: LeaseDriver, opts: LeaseOptions = {}): Promise<RunLease> {
  const sleep = opts.sleep ?? realSleep;
  const refuse = async (code: string, msg: string, unlock: boolean): Promise<never> => {
    if (unlock) await driver.unlock().catch(() => undefined);
    await driver.close().catch(() => undefined);
    throw new E2eTargetError("B", code, msg);
  };

  let ok: boolean;
  try {
    ok = await driver.tryLock();
  } catch {
    return refuse("LEASE_FAILED", "could not request the exclusive E2E run lease; refusing.", false);
  }
  if (!ok) return refuse("INSTANCE_BUSY", "another E2E run holds the exclusive lease on this instance (one run per instance); refusing.", false);

  // Drain fence: no test worker of an earlier run may still be connected — checked
  // twice, DRAIN_GRACE_MS apart.
  for (let pass = 0; pass < 2; pass++) {
    let free: boolean;
    try {
      if (pass === 1) await sleep(opts.drainGraceMs ?? DRAIN_GRACE_MS);
      free = await driver.drainTry();
      if (free) await driver.drainUnlock();
    } catch {
      return refuse("LEASE_FAILED", "could not verify the worker drain fence; refusing.", true);
    }
    if (!free) return refuse("INSTANCE_BUSY", "test workers of an earlier E2E run are still connected to this instance; refusing.", true);
  }

  let identity: LeaseIdentity;
  try {
    identity = await driver.identity();
  } catch {
    return refuse("LEASE_FAILED", "could not read the lease session identity; refusing.", true);
  }

  let released = false;
  const onLost = opts.onLost ?? defaultMainLost;
  const hb = watch(
    () => driver.stillHeld(),
    (reason) => {
      if (!released) onLost(reason);
    },
    opts.heartbeatMs ?? LEASE_HEARTBEAT_MS,
    opts.staleMs ?? LEASE_STALE_MS,
  );

  return {
    token: encodeLeaseToken(identity),
    async release() {
      if (released) return;
      released = true;
      hb.stop();
      await driver.unlock().catch(() => undefined);
      await driver.close().catch(() => undefined);
    },
  };
}

/** Driver over ONE pinned database session of a test-worker process. Never writes data. */
export interface FenceDriver {
  tryShared(): Promise<boolean>;
  check(lease: LeaseIdentity): Promise<{ leaseOk: boolean; fenceOk: boolean }>;
  close(): Promise<void>;
}

export interface FenceOptions {
  heartbeatMs?: number;
  staleMs?: number;
  /** Called once when the fence fails. Default: terminate this worker immediately. */
  onLost?: (reason: string) => void;
}

/**
 * Terminate THIS test-worker process immediately (fail closed).
 *
 * Vitest 3 replaces `process.exit` inside test workers with a function that only
 * throws ("process.exit unexpectedly called"), so it cannot stop a worker. SIGKILL to
 * the worker's own pid is unconditional on POSIX and Windows (TerminateProcess): no
 * further JavaScript — test body, hook or afterAll cleanup — runs in this process.
 * The reason is written synchronously first so it is not lost.
 */
export function terminateWorkerNow(reason: string): never {
  try {
    writeSync(2, `[e2e-run-lease] ${reason}; terminating this test worker (fail closed).\n`);
  } catch {
    // stderr unavailable: terminate anyway.
  }
  process.kill(process.pid, "SIGKILL");
  throw new Error("unreachable: worker termination did not take effect");
}

const defaultWorkerLost = (reason: string): void => {
  terminateWorkerNow(`worker execution fence FAILED (${reason})`);
};

/**
 * Worker side: hold the shared FENCE for this process's life and keep verifying the
 * run lease. Throws FENCE_FAILED (before any test file is imported) if the lease is not
 * held by the published session; afterwards any failure or stall calls onLost once.
 */
export async function holdWorkerFence(
  driver: FenceDriver,
  leaseToken: string | undefined,
  opts: FenceOptions = {},
): Promise<{ stop(): Promise<void> }> {
  const refuse = async (msg: string): Promise<never> => {
    await driver.close().catch(() => undefined);
    throw new E2eTargetError("B", "FENCE_FAILED", msg);
  };
  const lease = decodeLeaseToken(leaseToken);
  if (!lease) return refuse("no valid run-lease identity was provided to this worker; refusing.");

  let state: { leaseOk: boolean; fenceOk: boolean };
  try {
    if (!(await driver.tryShared())) return refuse("could not join the worker execution fence (another run is draining this instance); refusing.");
    state = await driver.check(lease);
  } catch {
    return refuse("could not verify the run lease from this worker; refusing.");
  }
  if (!state.leaseOk || !state.fenceOk) return refuse("the run lease is not held by this run's lease session; refusing.");

  const hb = watch(
    async () => {
      const s = await driver.check(lease);
      return s.leaseOk && s.fenceOk;
    },
    opts.onLost ?? defaultWorkerLost,
    opts.heartbeatMs ?? WORKER_HEARTBEAT_MS,
    opts.staleMs ?? WORKER_STALE_MS,
  );
  return {
    async stop() {
      hb.stop();
      await driver.close().catch(() => undefined);
    },
  };
}
