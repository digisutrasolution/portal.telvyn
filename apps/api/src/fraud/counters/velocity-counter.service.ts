import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { VelocityMetric } from "@prisma/client";
import { RedisService } from "@/infra/redis.service";

/**
 * Live velocity counters (Phase 12R-5, ADR-0021) — the real per-tenant call-rate
 * windows + concurrent-call gauge that feed the fraud decision's velocity check.
 * Redis-backed, reusing the auth rate-limiter's fixed-window pattern (INCR +
 * first-hit EXPIRE). **Fail-closed**: a read against an unreachable Redis throws
 * (the caller then denies), never silently returns zero.
 *
 * NOTE: nothing increments these counters at call time yet — the real
 * call-authorization path that records an authorized call (and the
 * concurrent-gauge acquire/release around a live call) is a later slice. This
 * slice builds and tests the mechanism and wires the READ into the decision so
 * the velocity check and its fail-closed behaviour are real.
 */
const RATE_WINDOW_SECONDS: Record<"CALLS_PER_MINUTE" | "CALLS_PER_HOUR" | "CALLS_PER_DAY", number> = {
  CALLS_PER_MINUTE: 60,
  CALLS_PER_HOUR: 3600,
  CALLS_PER_DAY: 86400,
};

export type VelocityCounts = Record<VelocityMetric, number>;

@Injectable()
export class VelocityCounterService {
  constructor(private readonly redis: RedisService) {}

  private rateKey(tenantId: string, metric: string): string {
    return `fraud:vel:${tenantId}:${metric}`;
  }
  private concurrentKey(tenantId: string): string {
    return `fraud:conc:${tenantId}`;
  }

  /**
   * Current counts for every velocity metric. Fail-closed: throws
   * ServiceUnavailable if Redis cannot be read, so the decision denies rather
   * than evaluating against unknown usage.
   */
  async read(tenantId: string): Promise<VelocityCounts> {
    try {
      const [cpm, cph, cpd, conc] = await this.redis.client.mget(
        this.rateKey(tenantId, "CALLS_PER_MINUTE"),
        this.rateKey(tenantId, "CALLS_PER_HOUR"),
        this.rateKey(tenantId, "CALLS_PER_DAY"),
        this.concurrentKey(tenantId),
      );
      return {
        CALLS_PER_MINUTE: toCount(cpm),
        CALLS_PER_HOUR: toCount(cph),
        CALLS_PER_DAY: toCount(cpd),
        CONCURRENT_CALLS: toCount(conc),
      };
    } catch {
      throw new ServiceUnavailableException("velocity counters unavailable");
    }
  }

  /**
   * Record one authorized call across the rate windows (CPM/CPH/CPD). INCR, and
   * on the first hit of a window set its TTL so the window rolls. Intended for
   * the future call-authorization path; fail-closed (throws on Redis error).
   */
  async recordCall(tenantId: string): Promise<void> {
    try {
      for (const [metric, seconds] of Object.entries(RATE_WINDOW_SECONDS)) {
        const key = this.rateKey(tenantId, metric);
        const n = await this.redis.client.incr(key);
        if (n === 1) await this.redis.client.expire(key, seconds);
      }
    } catch {
      throw new ServiceUnavailableException("velocity counters unavailable");
    }
  }

  /** Increment the concurrent-call gauge (call start). Returns the new value. */
  async acquireConcurrent(tenantId: string): Promise<number> {
    try {
      return await this.redis.client.incr(this.concurrentKey(tenantId));
    } catch {
      throw new ServiceUnavailableException("velocity counters unavailable");
    }
  }

  /** Decrement the concurrent-call gauge (call end), with a floor at zero. */
  async releaseConcurrent(tenantId: string): Promise<void> {
    // Compare-and-floor so a double-release or a lost acquire never goes negative.
    const lua = "local v = redis.call('decr', KEYS[1]); if tonumber(v) < 0 then redis.call('set', KEYS[1], 0); return 0 end; return v";
    try {
      await this.redis.client.eval(lua, 1, this.concurrentKey(tenantId));
    } catch {
      /* best-effort release — a stuck gauge self-heals on the next window/floor. */
    }
  }
}

function toCount(raw: string | null): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
