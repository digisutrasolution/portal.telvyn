import { Injectable } from "@nestjs/common";
import { KillSwitchScope } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import { decideFraud, type FraudDecision } from "./fraud-decision";

/**
 * Fraud Authorization Decision Service (Phase 12R-4, ADR-0021) — assembles the
 * policy snapshot for the active tenant and runs the pure evaluator. This slice
 * exposes it ONLY as a dry-run preview; it is NOT wired to a live call, a
 * reservation, or an engine, and nothing enforces its result.
 *
 * Live usage counters (period spend, call rates, concurrency) do not exist yet
 * (they arrive in 12R-5/6), so the snapshot's usage is zero here: the preview
 * therefore fully exercises the kill-switch, geo/destination rules, and the
 * per-call spend cap, while the period-spend and velocity checks pass until real
 * counters feed them.
 */
@Injectable()
export class FraudAuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(ctx: TenantContext, request: { destinationRaw: string; estimatedCostMicros?: number }): Promise<FraudDecision> {
    const [destinationRules, spendLimits, velocityLimits, tenantKs, globalKs] = await Promise.all([
      this.prisma.scoped.destinationRule.findMany({ where: { deletedAt: null, enabled: true } }),
      this.prisma.scoped.spendLimit.findMany({ where: { deletedAt: null, enabled: true } }),
      this.prisma.scoped.velocityLimit.findMany({ where: { deletedAt: null, enabled: true } }),
      this.prisma.killSwitch.findFirst({ where: { scope: KillSwitchScope.TENANT, tenantId: ctx.tenantId } }),
      this.prisma.killSwitch.findFirst({ where: { scope: KillSwitchScope.GLOBAL, tenantId: null } }),
    ]);

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
      usage: { spentMicros: {}, counts: {} }, // zero until live counters land (12R-5/6)
      request,
    });
  }
}
