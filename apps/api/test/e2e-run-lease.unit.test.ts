/**
 * INC-DB-001B-R M1 + INC-DB-001B-PRE2 N2 — exclusive E2E run lease and worker
 * execution fence (mocked drivers; no database). These prove the decision logic only;
 * the live behaviour is verified by the local-verify lease drills.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { E2eTargetError } from "./e2e-target-guard";
import {
  DRAIN_GRACE_MS,
  FENCE_CHECK_SQL,
  FENCE_DRAIN_TRY_SQL,
  FENCE_DRAIN_UNLOCK_SQL,
  FENCE_SHARED_TRY_SQL,
  LEASE_HELD_SQL,
  LEASE_IDENTITY_SQL,
  LEASE_TRY_SQL,
  LEASE_UNLOCK_SQL,
  WORKER_HEARTBEAT_MS,
  WORKER_STALE_MS,
  acquireRunLease,
  decodeLeaseToken,
  encodeLeaseToken,
  holdWorkerFence,
  terminateWorkerNow,
  watch,
  type FenceDriver,
  type LeaseDriver,
} from "./e2e-run-lease";

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> & T[K] };
const ID = { pid: 4242, started: "2026-11-27 10:00:00.123456+00" };
const noSleep = async () => undefined;

function driver(over: Partial<Record<keyof LeaseDriver, (...a: unknown[]) => Promise<unknown>>> = {}) {
  return {
    tryLock: vi.fn(over.tryLock ?? (async () => true)),
    stillHeld: vi.fn(over.stillHeld ?? (async () => true)),
    unlock: vi.fn(over.unlock ?? (async () => undefined)),
    identity: vi.fn(over.identity ?? (async () => ID)),
    drainTry: vi.fn(over.drainTry ?? (async () => true)),
    drainUnlock: vi.fn(over.drainUnlock ?? (async () => undefined)),
    close: vi.fn(over.close ?? (async () => undefined)),
  } as unknown as Mocked<LeaseDriver>;
}
function fence(over: Partial<Record<keyof FenceDriver, (...a: unknown[]) => Promise<unknown>>> = {}) {
  return {
    tryShared: vi.fn(over.tryShared ?? (async () => true)),
    check: vi.fn(over.check ?? (async () => ({ leaseOk: true, fenceOk: true }))),
    close: vi.fn(over.close ?? (async () => undefined)),
  } as unknown as Mocked<FenceDriver>;
}
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(E2eTargetError);
    return (e as E2eTargetError).code;
  }
  return "ACQUIRED";
}

afterEach(() => {
  vi.useRealTimers();
});

describe("exclusive run lease", () => {
  it("acquires when free, publishes the session identity, and release unlocks + closes exactly once", async () => {
    const d = driver();
    const lease = await acquireRunLease(d, { heartbeatMs: 60_000, sleep: noSleep, onLost: () => undefined });
    expect(lease.token).toBe(encodeLeaseToken(ID));
    await lease.release();
    await lease.release();
    expect(d.unlock).toHaveBeenCalledTimes(1);
    expect(d.close).toHaveBeenCalledTimes(1);
  });

  it("refuses a busy instance (another run holds the lease) and closes its session", async () => {
    const d = driver({ tryLock: async () => false });
    expect(await code(acquireRunLease(d, { sleep: noSleep }))).toBe("INSTANCE_BUSY");
    expect(d.close).toHaveBeenCalledTimes(1);
    expect(d.unlock).not.toHaveBeenCalled();
    expect(d.drainTry).not.toHaveBeenCalled();
  });

  it("refuses when the lease cannot be requested (query failure) without leaking the error", async () => {
    const d = driver({ tryLock: async () => { throw new Error("conn refused password=hunter2"); } });
    let msg = "";
    try {
      await acquireRunLease(d, { sleep: noSleep });
    } catch (e) {
      msg = (e as Error).message;
      expect((e as E2eTargetError).code).toBe("LEASE_FAILED");
    }
    expect(msg).not.toContain("hunter2");
  });

  it("N2: refuses while workers of an earlier run still hold the fence (first or second drain pass) and releases the lease", async () => {
    for (const busyOn of [1, 2]) {
      let pass = 0;
      const d = driver({ drainTry: async () => ++pass !== busyOn });
      expect(await code(acquireRunLease(d, { sleep: noSleep }))).toBe("INSTANCE_BUSY");
      expect(d.unlock).toHaveBeenCalledTimes(1);
      expect(d.close).toHaveBeenCalledTimes(1);
      expect(d.identity).not.toHaveBeenCalled();
    }
  });

  it("N2: drains twice, DRAIN_GRACE_MS apart, releasing the probe lock each time", async () => {
    const sleep = vi.fn(noSleep);
    const d = driver();
    const lease = await acquireRunLease(d, { sleep, heartbeatMs: 60_000, onLost: () => undefined });
    expect(d.drainTry).toHaveBeenCalledTimes(2);
    expect(d.drainUnlock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(DRAIN_GRACE_MS);
    expect(DRAIN_GRACE_MS).toBeGreaterThan(WORKER_HEARTBEAT_MS + WORKER_STALE_MS);
    await lease.release();
  });

  it("N2: refuses (LEASE_FAILED) when the drain probe or identity read fails, releasing the lease", async () => {
    for (const over of [{ drainTry: async () => { throw new Error("x"); } }, { identity: async () => { throw new Error("x"); } }]) {
      const d = driver(over);
      expect(await code(acquireRunLease(d, { sleep: noSleep }))).toBe("LEASE_FAILED");
      expect(d.unlock).toHaveBeenCalledTimes(1);
      expect(d.close).toHaveBeenCalledTimes(1);
    }
  });

  it("fails closed once if the lease is lost mid-run (lock gone, heartbeat error, or heartbeat stall)", async () => {
    vi.useFakeTimers();
    const never = () => new Promise<boolean>(() => undefined);
    for (const stillHeld of [async () => false, async () => { throw new Error("x"); }, never]) {
      const onLost = vi.fn();
      const lease = await acquireRunLease(driver({ stillHeld }), { heartbeatMs: 1000, staleMs: 3000, sleep: noSleep, onLost });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onLost).toHaveBeenCalledTimes(1);
      await lease.release();
    }
  });

  it("does not report loss while held, nor after release", async () => {
    vi.useFakeTimers();
    const onLost = vi.fn();
    const d = driver();
    const lease = await acquireRunLease(d, { heartbeatMs: 1000, sleep: noSleep, onLost });
    await vi.advanceTimersByTimeAsync(3500);
    expect(d.stillHeld).toHaveBeenCalled();
    await lease.release();
    d.stillHeld.mockImplementation(async () => false);
    await vi.advanceTimersByTimeAsync(3500);
    expect(onLost).not.toHaveBeenCalled();
  });

  it("lease SQL only takes/inspects/releases advisory locks (no data access)", () => {
    expect(LEASE_TRY_SQL).toMatch(/^SELECT pg_try_advisory_lock\(\d+, 1\) AS ok$/);
    expect(LEASE_UNLOCK_SQL).toMatch(/^SELECT pg_advisory_unlock\(\d+, 1\) AS ok$/);
    expect(FENCE_DRAIN_TRY_SQL).toMatch(/^SELECT pg_try_advisory_lock\(\d+, 2\) AS ok$/);
    expect(FENCE_DRAIN_UNLOCK_SQL).toMatch(/^SELECT pg_advisory_unlock\(\d+, 2\) AS ok$/);
    expect(FENCE_SHARED_TRY_SQL).toMatch(/^SELECT pg_try_advisory_lock_shared\(\d+, 2\) AS ok$/);
    expect(LEASE_HELD_SQL).toMatch(/FROM pg_locks/);
    expect(FENCE_CHECK_SQL).toMatch(/\$1::int/);
    expect(FENCE_CHECK_SQL).toMatch(/\$2::text/);
    for (const sql of [LEASE_TRY_SQL, LEASE_HELD_SQL, LEASE_UNLOCK_SQL, LEASE_IDENTITY_SQL, FENCE_DRAIN_TRY_SQL, FENCE_DRAIN_UNLOCK_SQL, FENCE_SHARED_TRY_SQL, FENCE_CHECK_SQL]) {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|pg_terminate_backend)\b/i);
    }
  });

  it("lease token round-trips and rejects malformed input", () => {
    expect(decodeLeaseToken(encodeLeaseToken(ID))).toEqual(ID);
    for (const bad of [undefined, "", "abc", "0@x", "12@", "-1@x", `1@${"x".repeat(65)}`]) {
      expect(decodeLeaseToken(bad)).toBeNull();
    }
  });
});

describe("worker execution fence (N2)", () => {
  it("joins the shared fence and verifies the published lease session", async () => {
    const d = fence();
    const f = await holdWorkerFence(d, encodeLeaseToken(ID), { heartbeatMs: 60_000, onLost: () => undefined });
    expect(d.tryShared).toHaveBeenCalledTimes(1);
    expect(d.check).toHaveBeenCalledWith(ID);
    await f.stop();
    expect(d.close).toHaveBeenCalledTimes(1);
  });

  it("refuses (FENCE_FAILED) and closes on a missing token, a draining instance, a foreign lease, a lost fence, or a query error", async () => {
    const cases: [string | undefined, Parameters<typeof fence>[0]][] = [
      [undefined, {}],
      ["garbage", {}],
      [encodeLeaseToken(ID), { tryShared: async () => false }],
      [encodeLeaseToken(ID), { check: async () => ({ leaseOk: false, fenceOk: true }) }],
      [encodeLeaseToken(ID), { check: async () => ({ leaseOk: true, fenceOk: false }) }],
      [encodeLeaseToken(ID), { check: async () => { throw new Error("password=hunter2"); } }],
    ];
    for (const [token, over] of cases) {
      const d = fence(over);
      let msg = "";
      try {
        await holdWorkerFence(d, token, { onLost: () => undefined });
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(await code(holdWorkerFence(fence(over), token, { onLost: () => undefined }))).toBe("FENCE_FAILED");
      expect(d.close).toHaveBeenCalledTimes(1);
      expect(msg).not.toContain("hunter2");
    }
  });

  it("terminates once when the lease moves, the fence disappears, a check errors, or a check stalls", async () => {
    vi.useFakeTimers();
    const never = () => new Promise<never>(() => undefined);
    const after = [
      async () => ({ leaseOk: false, fenceOk: true }),
      async () => ({ leaseOk: true, fenceOk: false }),
      async () => { throw new Error("terminated"); },
      never,
    ];
    for (const later of after) {
      let first = true;
      const d = fence({
        check: async () => {
          if (first) {
            first = false;
            return { leaseOk: true, fenceOk: true };
          }
          return later();
        },
      });
      const onLost = vi.fn();
      const f = await holdWorkerFence(d, encodeLeaseToken(ID), { heartbeatMs: 1000, staleMs: 3000, onLost });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onLost).toHaveBeenCalledTimes(1);
      await f.stop();
    }
  });

  it("does not fire while healthy, nor after stop", async () => {
    vi.useFakeTimers();
    const onLost = vi.fn();
    const d = fence();
    const f = await holdWorkerFence(d, encodeLeaseToken(ID), { heartbeatMs: 1000, staleMs: 3000, onLost });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(d.check.mock.calls.length).toBeGreaterThan(5);
    await f.stop();
    d.check.mockImplementation(async () => ({ leaseOk: false, fenceOk: false }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onLost).not.toHaveBeenCalled();
  });
});

describe("terminateWorkerNow (N2)", () => {
  it("SIGKILLs its own pid (Vitest stubs process.exit in workers) and never returns", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      expect(() => terminateWorkerNow("drill")).toThrow(/unreachable/);
      expect(kill).toHaveBeenCalledWith(process.pid, "SIGKILL");
    } finally {
      kill.mockRestore();
    }
  });
});

describe("watch()", () => {
  it("does not overlap checks: a slow check is not re-issued while in flight", async () => {
    vi.useFakeTimers();
    let resolve!: (v: boolean) => void;
    const check = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    const onFail = vi.fn();
    const w = watch(check, onFail, 1000, 10_000);
    await vi.advanceTimersByTimeAsync(3500);
    expect(check).toHaveBeenCalledTimes(1);
    resolve(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(2);
    expect(onFail).not.toHaveBeenCalled();
    w.stop();
  });
});
