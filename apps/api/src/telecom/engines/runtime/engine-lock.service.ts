import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RedisService } from "@/infra/redis.service";

/**
 * Single-node Redis mutex (Phase 12L) — prevents concurrent engine
 * synchronization from double-applying or corrupting version state. Uses the
 * existing Redis primitive (SET NX PX) + a compare-and-delete release; NOT a
 * distributed-lock framework. SECURITY: fails CLOSED — if Redis is unreachable
 * the lock is treated as UNAVAILABLE and the guarded action is refused.
 */
@Injectable()
export class EngineLockService {
  constructor(private readonly redis: RedisService) {}

  /** Run `fn` while holding the engine's sync lock. Throws EngineLockBusy if held, EngineLockUnavailable if Redis is down. */
  async withLock<T>(engineId: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const key = `engine-sync-lock:${engineId}`;
    const token = randomUUID();
    let acquired = false;
    try {
      acquired = (await this.redis.client.set(key, token, "PX", Math.max(1000, ttlMs), "NX")) === "OK";
    } catch {
      throw new EngineLockUnavailable();
    }
    if (!acquired) throw new EngineLockBusy();
    try {
      return await fn();
    } finally {
      // Compare-and-delete so we only release our own lock.
      const release = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
      await this.redis.client.eval(release, 1, key, token).catch(() => undefined);
    }
  }
}

export class EngineLockBusy extends Error {
  constructor() {
    super("engine sync already in progress");
    this.name = "EngineLockBusy";
  }
}
export class EngineLockUnavailable extends Error {
  constructor() {
    super("engine sync lock unavailable");
    this.name = "EngineLockUnavailable";
  }
}
