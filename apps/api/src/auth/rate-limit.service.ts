import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { RedisService } from "@/infra/redis.service";

export interface RateRule {
  /** Bucket name, e.g. "login-ip". */
  bucket: string;
  /** Max hits per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Redis fixed-window rate limiter. SECURITY BASELINE: fails CLOSED — if Redis
 * is unreachable the guarded action is refused (503), never silently allowed.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async consume(rule: RateRule, key: string): Promise<void> {
    const redisKey = `rl:${rule.bucket}:${key}`;
    let count: number;
    try {
      count = await this.redis.client.incr(redisKey);
      if (count === 1) await this.redis.client.expire(redisKey, rule.windowSeconds);
    } catch {
      throw new ServiceUnavailableException("Rate limiter unavailable — request refused");
    }
    if (count > rule.limit) {
      throw new HttpException("Too many requests — try again later", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Clear a bucket key (e.g. successful login resets the per-account window). */
  async reset(bucket: string, key: string): Promise<void> {
    try {
      await this.redis.client.del(`rl:${bucket}:${key}`);
    } catch {
      /* non-fatal — window will expire */
    }
  }
}

/** Route budgets (SECURITY.md baseline). */
export const RATE_RULES = {
  loginIp: { bucket: "login-ip", limit: 20, windowSeconds: 300 } satisfies RateRule,
  loginEmail: { bucket: "login-email", limit: 10, windowSeconds: 300 } satisfies RateRule,
  mfaVerify: { bucket: "mfa-verify", limit: 10, windowSeconds: 300 } satisfies RateRule,
  // Financial step-up issuance (Phase 13-2B S5): keyed by user; bounds TOTP guessing.
  stepUp: { bucket: "step-up-user", limit: 10, windowSeconds: 300 } satisfies RateRule,
  refresh: { bucket: "refresh-ip", limit: 60, windowSeconds: 300 } satisfies RateRule,
  resetRequest: { bucket: "reset-request-ip", limit: 5, windowSeconds: 900 } satisfies RateRule,
  resetConfirm: { bucket: "reset-confirm-ip", limit: 10, windowSeconds: 900 } satisfies RateRule,
  emailVerify: { bucket: "email-verify-ip", limit: 10, windowSeconds: 900 } satisfies RateRule,
  // Node heartbeat (ADR-0020): expected cadence ~2/min (30s interval); generous
  // headroom for retries while bounding a flood. Keyed by nodeId.
  nodeHeartbeat: { bucket: "node-heartbeat", limit: 120, windowSeconds: 60 } satisfies RateRule,
} as const;
