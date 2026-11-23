import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type VelocityLimit } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import { cursorArgs, toPage } from "@/common/pagination";
import type { CreateVelocityLimitInput, ListVelocityLimitsInput, UpdateVelocityLimitInput } from "./velocity-limits.dto";

/**
 * Velocity-limit authoring (Phase 12R-2b, ADR-0021) — DECLARATIVE fraud-policy
 * config only. Stores and manages a tenant's velocity limits; NOTHING counts or
 * enforces them (no call-rate check, no concurrent-call gauge — later slices).
 * Strictly tenant-owned: reads/create go through the tenant-scoping client
 * (deny-by-default, IDOR-safe); mutations resolve ownership via a scoped load
 * first, then mutate by id. Updates use optimistic concurrency; at most one
 * active limit per (tenant, metric).
 */
@Injectable()
export class VelocityLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  private view(v: VelocityLimit) {
    return {
      id: v.id,
      metric: v.metric,
      limit: v.limit,
      enabled: v.enabled,
      version: v.version,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  }

  async list(_ctx: TenantContext, f: ListVelocityLimitsInput) {
    const where: Prisma.VelocityLimitWhereInput = { deletedAt: null };
    if (f.metric) where.metric = f.metric;
    if (f.enabled !== undefined) where.enabled = f.enabled;
    const rows = await this.prisma.scoped.velocityLimit.findMany({ where, ...cursorArgs(f.limit, f.cursor) });
    const { items, nextCursor } = toPage(rows, f.limit);
    return { items: items.map((r) => this.view(r)), nextCursor };
  }

  private async load(id: string): Promise<VelocityLimit> {
    const v = await this.prisma.scoped.velocityLimit.findFirst({ where: { id, deletedAt: null } });
    if (!v) throw new NotFoundException("Velocity limit not found");
    return v;
  }

  async get(_ctx: TenantContext, id: string) {
    return this.view(await this.load(id));
  }

  async create(ctx: TenantContext, input: CreateVelocityLimitInput) {
    // At most one active (non-deleted) limit per (tenant, metric).
    const existing = await this.prisma.scoped.velocityLimit.findFirst({
      where: { metric: input.metric, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`A velocity limit for metric ${input.metric} already exists`);

    const v = await this.prisma.scoped.velocityLimit.create({
      data: {
        tenantId: ctx.tenantId, // server-derived; scoped client re-asserts it
        metric: input.metric,
        limit: input.limit,
        enabled: input.enabled ?? true,
      },
    });
    return this.view(v);
  }

  async update(ctx: TenantContext, id: string, input: UpdateVelocityLimitInput) {
    await this.load(id); // scoped ownership check → 404 for a foreign tenant
    const data: Prisma.VelocityLimitUncheckedUpdateInput = {};
    if (input.limit !== undefined) data.limit = input.limit;
    if (input.enabled !== undefined) data.enabled = input.enabled;

    if (input.expectedVersion !== undefined) {
      const res = await this.prisma.velocityLimit.updateMany({
        where: { id, version: input.expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (res.count !== 1) throw new ConflictException("Velocity limit was modified concurrently (version mismatch)");
    } else {
      await this.prisma.velocityLimit.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    }
    return this.get(ctx, id);
  }

  async remove(ctx: TenantContext, id: string) {
    await this.load(id); // scoped ownership check → 404 for a foreign tenant
    await this.prisma.velocityLimit.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
