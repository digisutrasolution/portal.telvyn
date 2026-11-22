import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { HealthEntityType, HealthStatus, TelecomStatus } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";

/** Normalized reachability posture for a node probe (never leaks internals). */
export type NodeReachability = "UNCONFIGURED" | "DISABLED" | "UNVERIFIED";

export interface NodeHealthReport {
  nodeId: string;
  status: HealthStatus;
  reachability: NodeReachability;
  /** Safe reason — never secrets or raw host details. */
  detail: string;
  correlationId: string;
  checkedAt: Date;
}

/**
 * Node health probe (Phase 12O-2au) — the operator-driven foundation of the node
 * health framework, mirroring the engine health probe (Phase 12L). There is no node
 * liveness connector yet, so a probe never fabricates HEALTHY: it reports an honest
 * posture from configuration (DISABLED when administratively disabled, UNCONFIGURED
 * with no `hostRef`, otherwise UNVERIFIED → UNKNOWN), writes the honest status to the
 * node's health snapshot, and records an append-only NODE HealthEvent only on a
 * genuine status transition. A real reachability connector can later replace the
 * posture resolution without changing this contract. No egress occurs here.
 */
@Injectable()
export class NodeHealthService {
  private readonly logger = new Logger("NodeHealthService");

  constructor(private readonly prisma: PrismaService) {}

  async probe(nodeId: string, correlationId: string): Promise<NodeHealthReport> {
    const node = await this.prisma.telecomNode.findFirst({
      where: { id: nodeId, deletedAt: null },
      select: { id: true, status: true, hostRef: true },
    });
    if (!node) throw new NotFoundException("Node not found");

    const { reachability, status, detail } = resolvePosture(node.status, node.hostRef);

    await this.prisma.$transaction([
      // 1:1 snapshot exists (created with the node); a probe is not a heartbeat, so
      // lastHeartbeatAt is untouched. latencyMs stays null — no measured round-trip.
      this.prisma.nodeHealth.update({ where: { nodeId }, data: { status, latencyMs: null } }),
    ]);
    await this.recordTransition(nodeId, status, detail, correlationId);

    this.logger.log(JSON.stringify({ nodeId, operation: "node.health.probe", correlationId, reachability, status }));
    return { nodeId, status, reachability, detail, correlationId, checkedAt: new Date() };
  }

  /** Append a NODE HealthEvent only when the status actually changed since the last one. */
  private async recordTransition(nodeId: string, toStatus: HealthStatus, reason: string, correlationId: string): Promise<void> {
    const last = await this.prisma.healthEvent.findFirst({
      where: { entityType: HealthEntityType.NODE, entityId: nodeId },
      orderBy: { createdAt: "desc" },
      select: { toStatus: true },
    });
    if (last?.toStatus === toStatus) return;
    await this.prisma.healthEvent.create({
      data: {
        entityType: HealthEntityType.NODE,
        entityId: nodeId,
        tenantId: null, // platform entity
        fromStatus: last?.toStatus ?? null,
        toStatus,
        reason: reason.slice(0, 500),
        correlationId,
      },
    });
  }
}

/** Honest posture from configuration — never fabricates HEALTHY (no liveness connector yet). */
function resolvePosture(status: TelecomStatus, hostRef: string | null): { reachability: NodeReachability; status: HealthStatus; detail: string } {
  if (status === TelecomStatus.DISABLED) {
    return { reachability: "DISABLED", status: HealthStatus.DISABLED, detail: "node is administratively disabled" };
  }
  if (!hostRef || hostRef.trim().length === 0) {
    return { reachability: "UNCONFIGURED", status: HealthStatus.UNKNOWN, detail: "no host reference configured" };
  }
  return { reachability: "UNVERIFIED", status: HealthStatus.UNKNOWN, detail: "no node liveness probe configured — health unverified" };
}
