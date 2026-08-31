import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { LcrSelectionStrategy, Prisma, type LcrRoute } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import { systemOrTenantWhere } from "@/authz/tenant-scope";
import { cursorArgs, toPage } from "@/common/pagination";
import type { CreateLcrPolicyInput, ListLcrPoliciesInput, RouteInputType, UpdateLcrPolicyInput } from "./lcr.dto";

const POLICY_INCLUDE = { routes: { where: { deletedAt: null } } } satisfies Prisma.LcrPolicyInclude;
type PolicyRow = Prisma.LcrPolicyGetPayload<{ include: typeof POLICY_INCLUDE }>;

/**
 * Deterministic candidate ordering (Phase 12J) — a PURE control-plane function.
 * The FUTURE engine adapter decides when a candidate fails; this only expresses
 * the selection order. Every strategy ends with a stable tie-breaker on id, so
 * ordering never depends on insertion or incidental DB order.
 */
export function orderCandidates(routes: LcrRoute[], strategy: LcrSelectionStrategy): LcrRoute[] {
  const byId = (a: LcrRoute, b: LcrRoute) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const cost = (a: LcrRoute, b: LcrRoute) => (a.costMicros < b.costMicros ? -1 : a.costMicros > b.costMicros ? 1 : 0);
  const prio = (a: LcrRoute, b: LcrRoute) => a.priority - b.priority; // lower number = higher preference
  const weight = (a: LcrRoute, b: LcrRoute) => (b.weight ?? 0) - (a.weight ?? 0); // higher weight first
  const chain =
    (...cmps: ((a: LcrRoute, b: LcrRoute) => number)[]) =>
    (a: LcrRoute, b: LcrRoute) => {
      for (const c of cmps) {
        const r = c(a, b);
        if (r !== 0) return r;
      }
      return 0;
    };
  const sorted = [...routes];
  switch (strategy) {
    case LcrSelectionStrategy.LOWEST_COST:
      return sorted.sort(chain(cost, prio, byId));
    case LcrSelectionStrategy.HIGHEST_PRIORITY:
      return sorted.sort(chain(prio, cost, byId));
    case LcrSelectionStrategy.WEIGHTED:
      return sorted.sort(chain(weight, prio, byId));
    case LcrSelectionStrategy.QUALITY_FIRST:
      // No quality/health subsystem exists yet (UNKNOWN). Deterministic fallback:
      // priority, then cost, then id. Quality is a future engine input.
      return sorted.sort(chain(prio, cost, byId));
    default:
      return sorted.sort(byId);
  }
}

/**
 * LCR policy foundation (Phase 12J) — declarative route SELECTION only. NOTHING
 * executed: no SIP/carrier connectivity, no LCR query, no rating, no billing.
 * Policies are strictly tenant-owned (auto-scoped). Route candidates reference
 * carriers/trunks (never duplicated; no secrets). Ordering is deterministic;
 * updates are atomic with optimistic concurrency.
 */
@Injectable()
export class LcrService {
  constructor(private readonly prisma: PrismaService) {}

  private routeView(r: LcrRoute) {
    return {
      id: r.id,
      carrierId: r.carrierId,
      sipTrunkId: r.sipTrunkId,
      prefix: r.prefix,
      country: r.country,
      costMicros: Number(r.costMicros), // bounded ≤1e12 → JSON-safe
      currency: r.currency,
      priority: r.priority,
      weight: r.weight,
      enabled: r.enabled,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
    };
  }

  private view(p: PolicyRow) {
    const ordered = orderCandidates(p.routes, p.selectionStrategy);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      selectionStrategy: p.selectionStrategy,
      enabled: p.enabled,
      version: p.version,
      // candidates returned in deterministic selection order (future decision contract)
      candidates: ordered.map((r) => this.routeView(r)),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  async list(_ctx: TenantContext, f: ListLcrPoliciesInput) {
    const where: Prisma.LcrPolicyWhereInput = { deletedAt: null };
    if (f.enabled !== undefined) where.enabled = f.enabled;
    if (f.strategy) where.selectionStrategy = f.strategy;
    if (f.q) where.name = { contains: f.q, mode: "insensitive" };
    const rows = await this.prisma.scoped.lcrPolicy.findMany({ where, include: POLICY_INCLUDE, ...cursorArgs(f.limit, f.cursor) });
    const { items, nextCursor } = toPage(rows, f.limit);
    return { items: items.map((r) => this.view(r)), nextCursor };
  }

  private async load(id: string): Promise<PolicyRow> {
    const p = await this.prisma.scoped.lcrPolicy.findFirst({ where: { id, deletedAt: null }, include: POLICY_INCLUDE });
    if (!p) throw new NotFoundException("LCR policy not found");
    return p;
  }

  async get(_ctx: TenantContext, id: string) {
    return this.view(await this.load(id));
  }

  async create(ctx: TenantContext, input: CreateLcrPolicyInput) {
    const routeData = await this.buildRoutes(ctx, input.routes ?? []);
    try {
      const p = await this.prisma.scoped.lcrPolicy.create({
        data: {
          tenantId: ctx.tenantId, // server-derived; scoped client re-asserts it
          name: input.name,
          description: input.description,
          selectionStrategy: input.selectionStrategy,
          enabled: input.enabled,
          routes: { create: routeData },
        },
        include: POLICY_INCLUDE,
      });
      return this.view(p);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("An LCR policy with this name already exists");
      }
      throw e;
    }
  }

  async update(ctx: TenantContext, id: string, input: UpdateLcrPolicyInput) {
    await this.load(id); // scoped → 404 for foreign tenant
    const routesReplace = input.routes !== undefined ? await this.buildRoutes(ctx, input.routes) : undefined;
    const data: Prisma.LcrPolicyUncheckedUpdateInput = {};
    if ("name" in input) data.name = input.name;
    if ("description" in input) data.description = input.description;
    if ("selectionStrategy" in input) data.selectionStrategy = input.selectionStrategy;
    if ("enabled" in input) data.enabled = input.enabled;
    try {
      await this.prisma.$transaction(async (tx) => {
        if (input.expectedVersion !== undefined) {
          const res = await tx.lcrPolicy.updateMany({ where: { id, version: input.expectedVersion }, data: { ...data, version: { increment: 1 } } });
          if (res.count !== 1) throw new ConflictException("LCR policy was modified concurrently (version mismatch)");
        } else {
          await tx.lcrPolicy.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
        }
        if (routesReplace !== undefined) {
          await tx.lcrRoute.deleteMany({ where: { lcrPolicyId: id } });
          if (routesReplace.length) await tx.lcrRoute.createMany({ data: routesReplace.map((r) => ({ ...r, lcrPolicyId: id })) });
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("An LCR policy with this name already exists");
      }
      throw e;
    }
    return this.get(ctx, id);
  }

  async remove(ctx: TenantContext, id: string) {
    await this.load(id); // scoped ownership check → 404 for foreign tenant
    await this.prisma.lcrPolicy.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Validate each route candidate (carrier accessible, trunk owned) → create data. */
  private async buildRoutes(ctx: TenantContext, routes: RouteInputType[]): Promise<Prisma.LcrRouteCreateManyLcrPolicyInput[]> {
    const out: Prisma.LcrRouteCreateManyLcrPolicyInput[] = [];
    for (const r of routes) {
      await this.assertCarrierAccessible(ctx, r.carrierId);
      if (r.sipTrunkId) await this.assertSipTrunkOwned(r.sipTrunkId);
      out.push({
        carrierId: r.carrierId,
        sipTrunkId: r.sipTrunkId,
        prefix: r.prefix,
        country: r.country,
        costMicros: BigInt(r.costMicros),
        currency: r.currency,
        priority: r.priority,
        weight: r.weight,
        enabled: r.enabled,
        effectiveFrom: r.effectiveFrom ? new Date(r.effectiveFrom) : undefined,
        effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : undefined,
      });
    }
    return out;
  }

  private async assertCarrierAccessible(ctx: TenantContext, carrierId: string): Promise<void> {
    const c = await this.prisma.carrier.findFirst({ where: { id: carrierId, deletedAt: null, ...systemOrTenantWhere(ctx.tenantId) }, select: { id: true } });
    if (!c) throw new BadRequestException("Carrier not found or not accessible in this scope");
  }

  private async assertSipTrunkOwned(sipTrunkId: string): Promise<void> {
    const t = await this.prisma.scoped.sipTrunk.findFirst({ where: { id: sipTrunkId, deletedAt: null }, select: { id: true } });
    if (!t) throw new BadRequestException("SIP trunk not found or not owned by this tenant");
  }
}
