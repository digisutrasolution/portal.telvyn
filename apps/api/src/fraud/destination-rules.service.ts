import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type DestinationRule } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import { cursorArgs, toPage } from "@/common/pagination";
import {
  normalizeMatchValue,
  type CreateDestinationRuleInput,
  type ListDestinationRulesInput,
  type UpdateDestinationRuleInput,
} from "./destination-rules.dto";

/**
 * Geo/destination-rule authoring (Phase 12R-2c, ADR-0021) — DECLARATIVE
 * fraud-policy config only. Stores and manages a tenant's allow/deny rules keyed
 * by COUNTRY or dial PREFIX; NOTHING evaluates, normalizes a live call, or
 * enforces them (later slices). Strictly tenant-owned: reads/create go through
 * the tenant-scoping client (deny-by-default, IDOR-safe); mutations resolve
 * ownership via a scoped load first, then mutate by id. The match value is
 * normalized before storage; at most one active rule per (tenant, matchType,
 * matchValue); updates use optimistic concurrency.
 */
@Injectable()
export class DestinationRulesService {
  constructor(private readonly prisma: PrismaService) {}

  private view(r: DestinationRule) {
    return {
      id: r.id,
      matchType: r.matchType,
      matchValue: r.matchValue,
      action: r.action,
      riskClass: r.riskClass,
      enabled: r.enabled,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async list(_ctx: TenantContext, f: ListDestinationRulesInput) {
    const where: Prisma.DestinationRuleWhereInput = { deletedAt: null };
    if (f.matchType) where.matchType = f.matchType;
    if (f.action) where.action = f.action;
    if (f.riskClass) where.riskClass = f.riskClass;
    if (f.enabled !== undefined) where.enabled = f.enabled;
    const rows = await this.prisma.scoped.destinationRule.findMany({ where, ...cursorArgs(f.limit, f.cursor) });
    const { items, nextCursor } = toPage(rows, f.limit);
    return { items: items.map((r) => this.view(r)), nextCursor };
  }

  private async load(id: string): Promise<DestinationRule> {
    const r = await this.prisma.scoped.destinationRule.findFirst({ where: { id, deletedAt: null } });
    if (!r) throw new NotFoundException("Destination rule not found");
    return r;
  }

  async get(_ctx: TenantContext, id: string) {
    return this.view(await this.load(id));
  }

  async create(ctx: TenantContext, input: CreateDestinationRuleInput) {
    const matchValue = normalizeMatchValue(input.matchType, input.matchValue);
    // At most one active (non-deleted) rule per (tenant, matchType, matchValue).
    const existing = await this.prisma.scoped.destinationRule.findFirst({
      where: { matchType: input.matchType, matchValue, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`A rule for ${input.matchType} ${matchValue} already exists`);

    const r = await this.prisma.scoped.destinationRule.create({
      data: {
        tenantId: ctx.tenantId, // server-derived; scoped client re-asserts it
        matchType: input.matchType,
        matchValue,
        action: input.action,
        riskClass: input.riskClass ?? "STANDARD",
        enabled: input.enabled ?? true,
      },
    });
    return this.view(r);
  }

  async update(ctx: TenantContext, id: string, input: UpdateDestinationRuleInput) {
    await this.load(id); // scoped ownership check → 404 for a foreign tenant
    const data: Prisma.DestinationRuleUncheckedUpdateInput = {};
    if (input.action !== undefined) data.action = input.action;
    if (input.riskClass !== undefined) data.riskClass = input.riskClass;
    if (input.enabled !== undefined) data.enabled = input.enabled;

    if (input.expectedVersion !== undefined) {
      const res = await this.prisma.destinationRule.updateMany({
        where: { id, version: input.expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (res.count !== 1) throw new ConflictException("Destination rule was modified concurrently (version mismatch)");
    } else {
      await this.prisma.destinationRule.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    }
    return this.get(ctx, id);
  }

  async remove(ctx: TenantContext, id: string) {
    await this.load(id); // scoped ownership check → 404 for a foreign tenant
    await this.prisma.destinationRule.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
