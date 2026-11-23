import { Injectable } from "@nestjs/common";
import { KillSwitchScope, type SpendLimitPeriod } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import { VelocityCounterService, type VelocityCounts } from "../counters/velocity-counter.service";
import { SpendReservationService } from "../reservations/spend-reservation.service";
import { decideFraud, type FraudDecision, type SpendLimitSnapshot, type VelocityLimitSnapshot } from "./fraud-decision";

/** A decision plus the enabled limits it was evaluated against (the enforcing hook reuses these). */
export interface DecisionResult {
  decision: FraudDecision;
  velocityLimits: VelocityLimitSnapshot[];
  spendLimits: SpendLimitSnapshot[];
}

/**
 * Fraud Authorization Decision Service (Phase 12R-4, ADR-0021) — assembles the
 * policy snapshot for the active tenant and runs the pure evaluator.
 *
 * Live usage feeds the snapshot: velocity counts come from the Redis velocity
 * counters (12R-5) and period spend from the spend-reservation ledger (12R-6),
 * each read only when a matching limit exists and each fail-closed (a store
 * outage denies rather than evaluating against unknown usage).
 *
 * `decide` is the shared assemble-and-evaluate used by BOTH the dry-run `preview`
 * (12R-4, read-only, no side effects) and the enforcing `CallAuthorizationService`
 * (12R-8, which commits reservations/counters). It performs no side effects
 * itself; enforcement is the caller's job.
 */
@Injectable()
export class FraudAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly velocityCounters: VelocityCounterService,
    private readonly spendReservations: SpendReservationService,
  ) {}

  /** Assemble the tenant's policy snapshot + live usage and run the evaluator. No side effects. */
  async decide(ctx: TenantContext, request: { destinationRaw: string; estimatedCostMicros?: number }): Promise<DecisionResult> {
    const [destinationRules, spendLimitRows, velocityLimitRows, tenantKs, globalKs] = await Promise.all([
      this.prisma.scoped.destinationRule.findMany({ where: { deletedAt: null, enabled: true } }),
      this.prisma.scoped.spendLimit.findMany({ where: { deletedAt: null, enabled: true } }),
      this.prisma.scoped.velocityLimit.findMany({ where: { deletedAt: null, enabled: true } }),
      this.prisma.killSwitch.findFirst({ where: { scope: KillSwitchScope.TENANT, tenantId: ctx.tenantId } }),
      this.prisma.killSwitch.findFirst({ where: { scope: KillSwitchScope.GLOBAL, tenantId: null } }),
    ]);
    const velocityLimits: VelocityLimitSnapshot[] = velocityLimitRows.map((v) => ({ metric: v.metric, limit: v.limit }));
    const spendLimits: SpendLimitSnapshot[] = spendLimitRows.map((s) => ({ period: s.period, amountMicros: Number(s.amountMicros), currency: s.currency }));

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

    const decision = decideFraud({
      killSwitch: { global: globalKs?.active ?? false, tenant: tenantKs?.active ?? false },
      destinationRules: destinationRules.map((r) => ({
        matchType: r.matchType,
        matchValue: r.matchValue,
        action: r.action,
        riskClass: r.riskClass,
      })),
      spendLimits,
      velocityLimits,
      usage: { spentMicros, counts },
      countersAvailable,
      reservationsAvailable,
      request,
    });
    return { decision, velocityLimits, spendLimits };
  }

  /** Dry-run (read-only) preview — the decision only, no side effects (12R-4). */
  async preview(ctx: TenantContext, request: { destinationRaw: string; estimatedCostMicros?: number }): Promise<FraudDecision> {
    return (await this.decide(ctx, request)).decision;
  }
}
