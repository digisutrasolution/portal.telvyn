import { Injectable } from "@nestjs/common";
import { KillSwitchScope, type SpendLimitPeriod } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import { VelocityCounterService, type VelocityCounts } from "../counters/velocity-counter.service";
import { SpendReservationService } from "../reservations/spend-reservation.service";
import { decideFraud, type FraudDecision } from "./fraud-decision";

/**
 * Fraud Authorization Decision Service (Phase 12R-4, ADR-0021) — assembles the
 * policy snapshot for the active tenant and runs the pure evaluator. This slice
 * exposes it ONLY as a dry-run preview; it is NOT wired to a live call, a
 * reservation, or an engine, and nothing enforces its result.
 *
 * Live usage now feeds the snapshot: velocity counts come from the Redis
 * velocity counters (12R-5) and period spend from the spend-reservation ledger
 * (12R-6), each read only when a matching limit exists and each fail-closed
 * (a store outage denies rather than evaluating against unknown usage). The
 * preview therefore exercises every control for real; it is still NOT wired to
 * a live call, a reservation, or an engine, and nothing enforces its result.
 */
@Injectable()
export class FraudAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly velocityCounters: VelocityCounterService,
    private readonly spendReservations: SpendReservationService,
  ) {}

  async preview(ctx: TenantContext, request: { destinationRaw: string; estimatedCostMicros?: number }): Promise<FraudDecision> {
    const [destinationRules, spendLimits, velocityLimits, tenantKs, globalKs] = await Promise.all([
      this.prisma.scoped.destinationRule.findMany({ where: { deletedAt: null, enabled: true } }),
      this.prisma.scoped.spendLimit.findMany({ where: { deletedAt: null, enabled: true } }),
      this.prisma.scoped.velocityLimit.findMany({ where: { deletedAt: null, enabled: true } }),
      this.prisma.killSwitch.findFirst({ where: { scope: KillSwitchScope.TENANT, tenantId: ctx.tenantId } }),
      this.prisma.killSwitch.findFirst({ where: { scope: KillSwitchScope.GLOBAL, tenantId: null } }),
    ]);

    // Live velocity counters — only read when velocity limits exist. Fail-closed:
    // if the read fails, flag it so the decision denies rather than guessing.
    let counts: Partial<VelocityCounts> = {};
    let countersAvailable = true;
    if (velocityLimits.length > 0) {
      try {
        counts = await this.velocityCounters.read(ctx.tenantId);
      } catch {
        countersAvailable = false;
      }
    }

    // Reserved period spend — only read when a period (non-PER_CALL) cap exists.
    // Fail-closed, same as the counters above.
    let spentMicros: Partial<Record<SpendLimitPeriod, number>> = {};
    let reservationsAvailable = true;
    if (spendLimits.some((s) => s.period !== "PER_CALL")) {
      try {
        spentMicros = await this.spendReservations.readReserved(ctx.tenantId);
      } catch {
        reservationsAvailable = false;
      }
    }

    return decideFraud({
      killSwitch: { global: globalKs?.active ?? false, tenant: tenantKs?.active ?? false },
      destinationRules: destinationRules.map((r) => ({
        matchType: r.matchType,
        matchValue: r.matchValue,
        action: r.action,
        riskClass: r.riskClass,
      })),
      spendLimits: spendLimits.map((s) => ({ period: s.period, amountMicros: Number(s.amountMicros), currency: s.currency })),
      velocityLimits: velocityLimits.map((v) => ({ metric: v.metric, limit: v.limit })),
      usage: { spentMicros, counts },
      countersAvailable,
      reservationsAvailable,
      request,
    });
  }
}
