import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { HealthEntityType, HealthStatus, TelecomStatus } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import { RedisService } from "@/infra/redis.service";

export interface EvaluationSummary {
  /** True when the sweep did not run (lock held by another instance, or Redis unavailable). */
  skipped: boolean;
  reason?: "locked" | "lock-unavailable";
  evaluated: number;
  transitioned: number;
  correlationId: string;
}

const LOCK_KEY = "node-health-evaluator-lock";
const DEFAULT_TTL_MS = 90_000; // ADR-0020: staleness TTL default (>= 2x the 30s heartbeat interval)

/** Staleness TTL in ms, from env (platform-configurable), floored to a sane minimum. */
function ttlMs(): number {
  const raw = Number(process.env.NODE_HEARTBEAT_TTL_MS);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : DEFAULT_TTL_MS;
}

/**
 * Dead-man's-switch evaluator (ADR-0020 slice 3, Phase 12O-2bb). The periodic job
 * that makes node health REAL: it compares each node's `lastHeartbeatAt` to the
 * staleness TTL and records an honest status transition on change. This is the
 * ONLY writer of HEALTHY for a node (the heartbeat ingest only stamps liveness).
 *
 * State model (ADR-0020, caps at UNKNOWN — silence is absence of evidence, never a
 * fault): administratively `DISABLED` → `DISABLED`; a heartbeat within the TTL →
 * `HEALTHY`; otherwise (stale or never seen) → `UNKNOWN`. There is NO
 * `DEGRADED`/`UNHEALTHY`-from-silence.
 *
 * Run by a NEW dedicated external cron calling the trigger endpoint on the TTL
 * cadence (the app adds no scheduler dependency). Multi-instance safe: a Redis
 * SET-NX lock means only one sweep runs per tick; it FAILS CLOSED — if the lock is
 * held or Redis is down, the tick is skipped (never a racing double-write), and the
 * next tick retries. Transitions (not ticks) are the durable record — append-only
 * `HealthEvent`, the same rows the operator probe and the NOC history use.
 */
@Injectable()
export class NodeHealthEvaluatorService {
  private readonly logger = new Logger("NodeHealthEvaluatorService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** The honest target status for a node — pure, caps at UNKNOWN. */
  static decideTarget(status: TelecomStatus, lastHeartbeatAt: Date | null, now: number, windowMs: number): HealthStatus {
    if (status === TelecomStatus.DISABLED) return HealthStatus.DISABLED;
    if (lastHeartbeatAt && now - lastHeartbeatAt.getTime() <= windowMs) return HealthStatus.HEALTHY;
    return HealthStatus.UNKNOWN; // stale, or never seen a heartbeat
  }

  async sweep(correlationId: string = randomUUID()): Promise<EvaluationSummary> {
    const token = randomUUID();
    const window = ttlMs();
    let acquired = false;
    try {
      // Hold the lock a little longer than a tick is expected to take.
      acquired = (await this.redis.client.set(LOCK_KEY, token, "PX", 30_000, "NX")) === "OK";
    } catch {
      this.logger.warn(JSON.stringify({ operation: "node.health.evaluate", correlationId, skipped: true, reason: "lock-unavailable" }));
      return { skipped: true, reason: "lock-unavailable", evaluated: 0, transitioned: 0, correlationId };
    }
    if (!acquired) {
      return { skipped: true, reason: "locked", evaluated: 0, transitioned: 0, correlationId };
    }

    try {
      const nodes = await this.prisma.telecomNode.findMany({
        where: { deletedAt: null },
        select: { id: true, status: true, health: { select: { status: true, lastHeartbeatAt: true } } },
      });
      const now = Date.now();
      let transitioned = 0;
      for (const node of nodes) {
        if (!node.health) continue; // 1:1 row is created with the node; defensive only
        const current = node.health.status;
        const target = NodeHealthEvaluatorService.decideTarget(node.status, node.health.lastHeartbeatAt, now, window);
        if (target === current) continue; // append-only: a transition only on genuine change
        await this.prisma.$transaction([
          this.prisma.nodeHealth.update({ where: { nodeId: node.id }, data: { status: target } }),
          this.prisma.healthEvent.create({
            data: {
              entityType: HealthEntityType.NODE,
              entityId: node.id,
              tenantId: null, // platform entity
              fromStatus: current,
              toStatus: target,
              reason: reasonFor(target),
              correlationId,
            },
          }),
        ]);
        transitioned += 1;
      }
      this.logger.log(JSON.stringify({ operation: "node.health.evaluate", correlationId, evaluated: nodes.length, transitioned }));
      return { skipped: false, evaluated: nodes.length, transitioned, correlationId };
    } finally {
      const release = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
      await this.redis.client.eval(release, 1, LOCK_KEY, token).catch(() => undefined);
    }
  }
}

function reasonFor(target: HealthStatus): string {
  if (target === HealthStatus.DISABLED) return "node is administratively disabled";
  if (target === HealthStatus.HEALTHY) return "heartbeat within TTL";
  return "no recent heartbeat — liveness unverified";
}
