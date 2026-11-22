import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { HealthEntityType, HealthStatus, TelecomStatus } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import { systemOrTenantWhere } from "@/authz/tenant-scope";
import { cursorArgs, toPage } from "@/common/pagination";

/** Normalized reachability posture for a carrier probe (never leaks internals). */
export type CarrierReachability = "UNCONFIGURED" | "DISABLED" | "UNVERIFIED";

export interface CarrierHealthReport {
  carrierId: string;
  status: HealthStatus;
  reachability: CarrierReachability;
  /** Safe reason — never secrets or raw endpoint details. */
  detail: string;
  correlationId: string;
  checkedAt: Date;
}

/**
 * Carrier health probe (Phase 12O-2aw) — the operator-driven foundation of the
 * carrier health framework, mirroring the node probe (Phase 12O-2au). Unlike nodes,
 * carriers have no 1:1 health snapshot table, so this is **event-only** (ADR-less,
 * owner-chosen 2026-11-23): the honest current status is derived from the latest
 * CARRIER HealthEvent, and a new append-only event is written only on a genuine
 * transition. There is no carrier liveness connector yet, so a probe never fabricates
 * HEALTHY: it reports an honest posture from configuration — DISABLED when
 * administratively disabled, UNCONFIGURED with no SIP endpoint, otherwise UNVERIFIED →
 * UNKNOWN. A real reachability connector can later replace the posture resolution
 * without changing this contract. No egress occurs here. The carrier is resolved
 * through the caller's scope (own + system), so a foreign carrier is simply 404.
 */
@Injectable()
export class CarrierHealthService {
  private readonly logger = new Logger("CarrierHealthService");

  constructor(private readonly prisma: PrismaService) {}

  async probe(ctx: TenantContext, carrierId: string, correlationId: string): Promise<CarrierHealthReport> {
    // Visibility = own + system; a foreign-tenant carrier is simply not found.
    const carrier = await this.prisma.carrier.findFirst({
      where: { id: carrierId, deletedAt: null, ...systemOrTenantWhere(ctx.tenantId) },
      select: {
        id: true,
        tenantId: true,
        status: true,
        // One live endpoint is enough to count as "configured".
        sipEndpoints: { where: { deletedAt: null }, select: { id: true }, take: 1 },
      },
    });
    if (!carrier) throw new NotFoundException("Carrier not found");

    const { reachability, status, detail } = resolvePosture(carrier.status, carrier.sipEndpoints.length > 0);

    await this.recordTransition(carrier.id, carrier.tenantId, status, detail, correlationId);

    this.logger.log(JSON.stringify({ carrierId, operation: "carrier.health.probe", correlationId, reachability, status }));
    return { carrierId, status, reachability, detail, correlationId, checkedAt: new Date() };
  }

  /**
   * The carrier's append-only health-event history, newest first, cursor-paginated.
   * A safe view only (no entityType/entityId/tenantId echo) — the same shape as the
   * node and engine health histories (Phase 12O-2ax). Ordering + cursor use the
   * uuidv7 id (time-ordered). The caller's scope/404 gate is enforced upstream (the
   * controller resolves the carrier through CarriersService.get first).
   */
  async history(carrierId: string, page: { limit: number; cursor?: string }) {
    const rows = await this.prisma.healthEvent.findMany({
      where: { entityType: HealthEntityType.CARRIER, entityId: carrierId },
      ...cursorArgs(page.limit, page.cursor),
    });
    const { items, nextCursor } = toPage(rows, page.limit);
    return {
      items: items.map((e) => ({
        id: e.id,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        reason: e.reason,
        correlationId: e.correlationId,
        createdAt: e.createdAt,
      })),
      nextCursor,
    };
  }

  /** Append a CARRIER HealthEvent only when the status actually changed since the last one. */
  private async recordTransition(
    carrierId: string,
    tenantId: string | null,
    toStatus: HealthStatus,
    reason: string,
    correlationId: string,
  ): Promise<void> {
    const last = await this.prisma.healthEvent.findFirst({
      where: { entityType: HealthEntityType.CARRIER, entityId: carrierId },
      orderBy: { createdAt: "desc" },
      select: { toStatus: true },
    });
    if (last?.toStatus === toStatus) return;
    await this.prisma.healthEvent.create({
      data: {
        entityType: HealthEntityType.CARRIER,
        entityId: carrierId,
        tenantId, // the carrier's owner (null = system/platform carrier)
        fromStatus: last?.toStatus ?? null,
        toStatus,
        reason: reason.slice(0, 500),
        correlationId,
      },
    });
  }
}

/** Honest posture from configuration — never fabricates HEALTHY (no liveness connector yet). */
function resolvePosture(status: TelecomStatus, hasEndpoint: boolean): { reachability: CarrierReachability; status: HealthStatus; detail: string } {
  if (status === TelecomStatus.DISABLED) {
    return { reachability: "DISABLED", status: HealthStatus.DISABLED, detail: "carrier is administratively disabled" };
  }
  if (!hasEndpoint) {
    return { reachability: "UNCONFIGURED", status: HealthStatus.UNKNOWN, detail: "no SIP endpoint configured" };
  }
  return { reachability: "UNVERIFIED", status: HealthStatus.UNKNOWN, detail: "no carrier liveness probe configured — health unverified" };
}
