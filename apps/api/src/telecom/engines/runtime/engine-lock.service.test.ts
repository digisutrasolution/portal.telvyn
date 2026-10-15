import { describe, expect, it, vi } from "vitest";
import { EngineLockService, EngineLockBusy, EngineLockUnavailable } from "./engine-lock.service";
import type { RedisService } from "@/infra/redis.service";

/**
 * Phase 12M-A preflight (contract/failure-safety). The sync mutex is the
 * concurrency guard for configuration apply; these cover its honest behavior
 * with a fake Redis client — no real Redis, no engine. They do NOT imply any
 * real-engine interoperability.
 */
function makeLock(client: { set: unknown; eval: unknown }) {
  return new EngineLockService({ client } as unknown as RedisService);
}

describe("EngineLockService — acquire / run / release", () => {
  it("acquires (SET NX PX), runs fn, returns its result, and releases our own token", async () => {
    const set = vi.fn().mockResolvedValue("OK");
    const evalFn = vi.fn().mockResolvedValue(1);
    const lock = makeLock({ set, eval: evalFn });

    const result = await lock.withLock("engine-1", 5000, async () => "done");
    expect(result).toBe("done");

    // SET key token PX <ttl≥1000> NX
    expect(set).toHaveBeenCalledTimes(1);
    const args = set.mock.calls[0];
    expect(args[0]).toBe("engine-sync-lock:engine-1");
    expect(args[2]).toBe("PX");
    expect(args[3]).toBeGreaterThanOrEqual(1000);
    expect(args[4]).toBe("NX");
    // compare-and-delete release uses the SAME token that was set
    expect(evalFn).toHaveBeenCalledTimes(1);
    expect(evalFn.mock.calls[0][3]).toBe(args[1]);
  });

  it("enforces a minimum lock TTL (never a sub-second lease)", async () => {
    const set = vi.fn().mockResolvedValue("OK");
    const lock = makeLock({ set, eval: vi.fn().mockResolvedValue(1) });
    await lock.withLock("engine-2", 10, async () => null); // tiny ttl requested
    expect(set.mock.calls[0][3]).toBe(1000); // clamped up
  });
});

describe("EngineLockService — failure safety", () => {
  it("refuses with EngineLockBusy when the lock is already held (SET NX → null) and never runs fn", async () => {
    const fn = vi.fn();
    const lock = makeLock({ set: vi.fn().mockResolvedValue(null), eval: vi.fn() });
    await expect(lock.withLock("engine-3", 5000, fn)).rejects.toBeInstanceOf(EngineLockBusy);
    expect(fn).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED: Redis outage → EngineLockUnavailable, fn never runs", async () => {
    const fn = vi.fn();
    const lock = makeLock({ set: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")), eval: vi.fn() });
    await expect(lock.withLock("engine-4", 5000, fn)).rejects.toBeInstanceOf(EngineLockUnavailable);
    expect(fn).not.toHaveBeenCalled();
  });

  it("still releases the lock when fn throws (no leaked lock)", async () => {
    const evalFn = vi.fn().mockResolvedValue(1);
    const lock = makeLock({ set: vi.fn().mockResolvedValue("OK"), eval: evalFn });
    await expect(
      lock.withLock("engine-5", 5000, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(evalFn).toHaveBeenCalledTimes(1); // released despite the failure
  });

  it("a release-time Redis error is swallowed (does not mask the operation result)", async () => {
    const lock = makeLock({ set: vi.fn().mockResolvedValue("OK"), eval: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(lock.withLock("engine-6", 5000, async () => "ok")).resolves.toBe("ok");
  });
});
