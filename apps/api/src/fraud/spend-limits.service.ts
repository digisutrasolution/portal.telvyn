import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type SpendLimit } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import { cursorArgs, toPage } from "@/common/pagination";
import type { CreateSpendLimitInput, ListSpendLimitsInput, UpdateSpendLimitInput } from "./spend-limits.dto";

/**
 * Spend-limit authoring (Phase 12R-2a, ADR-0021) — DECLARATIVE fraud-policy
 * config only. This service stores and manages a tenant's spend limits; NOTHING
 * reads or enforces them (no call authorization, no reservation, no balance
 * gate — later slices). Strictly tenant-owned: reads/create go through the
 * tenant-scoping client (deny-by-default, IDOR-safe); mutations resolve
 * ownership via a scoped load first, then mutate by id. Money is integer micros
 * (never float); updates use optimistic concurrency; at most one active limit
 * per (tenant, period).
 */
@Injectable()
export class SpendLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  private view(s: SpendLimit) {
    return {
      id: s.id,
      period: s.period,
      amountMicros: Number(s.amountMicros), // bounded ≤1e15 → JSON-safe
      currency: s.currency,
      enabled: s.enabled,
      version: s.version,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  async list(_ctx: TenantContext, f: ListSpendLimitsInput) {
    const where: Prisma.SpendLimitWhereInput = { deletedAt: null };
    if (f.period) where.period = f.period;
    if (f.enabled !== undefined) where.enabled = f.enabled;
    const rows = await this.prisma.scoped.spendLimit.findMany({ where, ...cursorArgs(f.limit, f.cursor) });
    const { items, nextCursor } = toPage(rows, f.limit);
    return { items: items.map((r) => this.view(r)), nextCursor };
  }

  private async load(id: string): Promise<SpendLimit> {
    const s = await this.prisma.scoped.spendLimit.findFirst({ where: { id, deletedAt: null } });
    if (!s) throw new NotFoundException("Spend limit not found");
    return s;
  }

  async get(_ctx: TenantContext, id: string) {
    return this.view(await this.load(id));
  }

  async create(ctx: TenantContext, input: CreateSpendLimitInput) {
    // At most one active (non-deleted) limit per (tenant, period). The scoped
    // client confines this check to the caller's tenant.
    const existing = await this.prisma.scoped.spendLimit.findFirst({
      where: { period: input.period, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`A spend limit for period ${input.period} already exists`);

    const s = await this.prisma.scoped.spendLimit.create({
      data: {
        tenantId: ctx.tenantId, // server-derived; scoped client re-asserts it
        period: input.period,
        amountMicros: BigInt(input.amountMicros),
        currency: input.currency ?? "USD",
        enabled: input.enabled ?? true,
      },
    });
    return this.view(s);
  }

  async update(ctx: TenantContext, id: string, input: UpdateSpendLimitInput) {
    await this.load(id); // scoped ownership check → 404 for a foreign tenant
    const data: Prisma.SpendLimitUncheckedUpdateInput = {};
    if (input.amountMicros !== undefined) data.amountMicros = BigInt(input.amountMicros);
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.enabled !== undefined) data.enabled = input.enabled;

    if (input.expectedVersion !== undefined) {
      const res = await this.prisma.spendLimit.updateMany({
        where: { id, version: input.expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (res.count !== 1) throw new ConflictException("Spend limit was modified concurrently (version mismatch)");
    } else {
      await this.prisma.spendLimit.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    }
    return this.get(ctx, id);
  }

  async remove(ctx: TenantContext, id: string) {
    await this.load(id); // scoped ownership check → 404 for a foreign tenant
    await this.prisma.spendLimit.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
