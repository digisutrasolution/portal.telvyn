import { Injectable, Logger } from "@nestjs/common";
import { HealthEntityType, HealthStatus, TelecomStatus, type TelecomEngineType } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import { EngineConnectionManager, type ReachabilityState } from "./engine-connection.manager";

export interface EngineHealthReport {
  engineId: string;
  provider: TelecomEngineType;
  status: HealthStatus;
  reachability: ReachabilityState;
  latencyMs?: number;
  /** Safe reason — never secrets or raw provider errors. */
  detail: string;
  correlationId: string;
  checkedAt: Date;
}

/** Map a normalized reachability posture to an HONEST health status. */
function toHealth(state: ReachabilityState): HealthStatus {
  switch (state) {
    case "REACHABLE":
      return HealthStatus.HEALTHY;
    case "UNREACHABLE":
      return HealthStatus.UNHEALTHY;
    case "DISABLED":
      return HealthStatus.DISABLED;
    // UNCONFIGURED / BLOCKED / UNVERIFIED — we have NOT proven health → UNKNOWN.
    default:
      return HealthStatus.UNKNOWN;
  }
}

/**
 * Engine health probing (Phase 12L). Resolves reachability via the SSRF-guarded
 * connection manager and normalizes it to an honest HealthStatus — never a
 * fabricated HEALTHY. Records an append-only HealthEvent only on a genuine
 * status transition.
 */
@Injectable()
export class EngineHealthService {
  private readonly logger = new Logger("EngineHealthService");

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: EngineConnectionManager,
  ) {}

  async probe(
    engine: { id: string; type: TelecomEngineType; endpoint: string | null; credentialId?: string | null; status: TelecomStatus },
    correlationId: string,
  ): Promise<EngineHealthReport> {
    const conn = await this.connection.resolve({
      provider: engine.type,
      endpoint: engine.endpoint,
      credentialId: engine.credentialId ?? null,
      status: engine.status,
      correlationId,
    });
    const status = toHealth(conn.state);
    await this.recordTransition(engine.id, status, conn.detail, correlationId);
    this.logger.log(
      JSON.stringify({ engineId: engine.id, provider: engine.type, operation: "health.probe", correlationId, reachability: conn.state, status }),
    );
    return {
      engineId: engine.id,
      provider: engine.type,
      status,
      reachability: conn.state,
      latencyMs: conn.probe?.latencyMs,
      detail: conn.detail,
      correlationId,
      checkedAt: new Date(),
    };
  }

  /** Append a HealthEvent only when the status actually changed since the last one. */
  private async recordTransition(engineId: string, toStatus: HealthStatus, reason: string, correlationId: string): Promise<void> {
    const last = await this.prisma.healthEvent.findFirst({
      where: { entityType: HealthEntityType.ENGINE, entityId: engineId },
      orderBy: { createdAt: "desc" },
      select: { toStatus: true },
    });
    if (last?.toStatus === toStatus) return;
    await this.prisma.healthEvent.create({
      data: {
        entityType: HealthEntityType.ENGINE,
        entityId: engineId,
        tenantId: null, // platform entity
        fromStatus: last?.toStatus ?? null,
        toStatus,
        reason: reason.slice(0, 500),
        correlationId,
      },
    });
  }
}
