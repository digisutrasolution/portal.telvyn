import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { HealthStatus, Prisma, TenantType, type Did } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import { systemOrTenantWhere } from "@/authz/tenant-scope";
import { cursorArgs, toPage } from "@/common/pagination";
import { normalizeE164 } from "./e164";
import type { CreateDidInput, ListDidsInput, UpdateDidInput } from "./dids.dto";

/**
 * DID foundation (Phase 12G) — control-plane resource only; NO telecom runtime.
 * DIDs are strictly tenant-owned via the auto-scoping client (deny-by-default +
 * IDOR). The nullable-tenantId platform inventory pool is NOT exposed by this
 * API. Numbers are stored canonical E.164; global uniqueness is DB-enforced.
 * Responses carry safe reference ids only — never embedded related objects.
 */
@Injectable()
export class DidsService {
  constructor(private readonly prisma: PrismaService) {}

  private isPlatform(ctx: TenantContext): boolean {
    return ctx.tenantType === TenantType.PLATFORM;
  }

  private view(d: Did) {
    return {
      id: d.id,
      e164: d.e164,
      country: d.country,
      status: d.status, // administrative status (distinct from health)
      carrierId: d.carrierId,
      sipTrunkId: d.sipTrunkId,
      routingProfileId: d.routingProfileId,
      regionId: d.regionId,
      assignedAt: d.assignedAt,
      // Honest: no live SIP path check exists — UNKNOWN, never fabricated.
      health: { status: HealthStatus.UNKNOWN, detail: "no health check configured" },
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  async list(_ctx: TenantContext, f: ListDidsInput) {
    const where: Prisma.DidWhereInput = { deletedAt: null };
    if (f.status) where.status = f.status;
    if (f.carrierId) where.carrierId = f.carrierId;
    if (f.sipTrunkId) where.sipTrunkId = f.sipTrunkId;
    if (f.routingProfileId) where.routingProfileId = f.routingProfileId;
    if (f.regionId) where.regionId = f.regionId;
    if (f.country) where.country = f.country;
    if (f.q) where.e164 = { contains: f.q }; // canonical, indexed
    const rows = await this.prisma.scoped.did.findMany({ where, ...cursorArgs(f.limit, f.cursor) });
    const { items, nextCursor } = toPage(rows, f.limit);
    return { items: items.map((r) => this.view(r)), nextCursor };
  }

  private async load(id: string): Promise<Did> {
    const d = await this.prisma.scoped.did.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw new NotFoundException("DID not found");
    return d;
  }

  async get(_ctx: TenantContext, id: string) {
    return this.view(await this.load(id));
  }

  async create(ctx: TenantContext, input: CreateDidInput) {
    const norm = normalizeE164(input.number);
    if (!norm.ok) throw new BadRequestException(norm.reason);
    await this.validateRelationships(ctx, {
      carrierId: input.carrierId,
      sipTrunkId: input.sipTrunkId,
      routingProfileId: input.routingProfileId,
      regionId: input.regionId,
    });
    try {
      const d = await this.prisma.scoped.did.create({
        data: {
          tenantId: ctx.tenantId, // server-derived; the scoped client re-asserts it
          e164: norm.value.e164,
          country: norm.value.country, // derived from the number, never trusted from client
          status: input.status,
          carrierId: input.carrierId,
          sipTrunkId: input.sipTrunkId,
          routingProfileId: input.routingProfileId,
          regionId: input.regionId,
        },
      });
      return this.view(d);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("A DID with this number already exists");
      }
      throw e;
    }
  }

  async update(ctx: TenantContext, id: string, input: UpdateDidInput) {
    const current = await this.load(id); // scoped → 404 for foreign tenant
    // Effective relationship values after the patch (a null explicitly detaches).
    const eff = <T>(key: "carrierId" | "sipTrunkId" | "routingProfileId" | "regionId"): T =>
      (key in input ? (input as Record<string, unknown>)[key] : current[key]) as T;
    await this.validateRelationships(ctx, {
      carrierId: eff<string | null>("carrierId") ?? undefined,
      sipTrunkId: eff<string | null>("sipTrunkId") ?? undefined,
      routingProfileId: eff<string | null>("routingProfileId") ?? undefined,
      regionId: eff<string | null>("regionId") ?? undefined,
    });
    const data: Prisma.DidUncheckedUpdateInput = {};
    if ("status" in input) data.status = input.status;
    if ("carrierId" in input) data.carrierId = input.carrierId;
    if ("sipTrunkId" in input) data.sipTrunkId = input.sipTrunkId;
    if ("routingProfileId" in input) data.routingProfileId = input.routingProfileId;
    if ("regionId" in input) data.regionId = input.regionId;
    // tenantId/e164 are never in the DTO → ownership + number are immutable.
    const d = await this.prisma.did.update({ where: { id }, data });
    return this.view(d);
  }

  async remove(ctx: TenantContext, id: string) {
    await this.load(id); // scoped ownership check → 404 for foreign tenant
    await this.prisma.did.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Validate every supplied relationship server-side: carrier accessible in
   * scope; SIP trunk owned by this tenant; routing profile owned; region exists;
   * and carrier/trunk consistency (trunk must belong to the referenced carrier).
   */
  private async validateRelationships(
    ctx: TenantContext,
    rels: { carrierId?: string; sipTrunkId?: string; routingProfileId?: string; regionId?: string },
  ): Promise<void> {
    if (rels.carrierId) await this.assertCarrierAccessible(ctx, rels.carrierId);
    let trunkCarrierId: string | null = null;
    if (rels.sipTrunkId) trunkCarrierId = await this.assertSipTrunkOwned(rels.sipTrunkId);
    if (rels.routingProfileId) await this.assertRoutingProfileOwned(ctx, rels.routingProfileId);
    if (rels.regionId) await this.assertRegionExists(rels.regionId);
    // Consistency: if both carrier and trunk are set, the trunk must belong to that carrier.
    if (rels.carrierId && rels.sipTrunkId && trunkCarrierId !== rels.carrierId) {
      throw new BadRequestException("SIP trunk does not belong to the referenced carrier");
    }
  }

  private async assertCarrierAccessible(ctx: TenantContext, carrierId: string): Promise<void> {
    const c = await this.prisma.carrier.findFirst({
      where: { id: carrierId, deletedAt: null, ...systemOrTenantWhere(ctx.tenantId) },
      select: { id: true },
    });
    if (!c) throw new BadRequestException("Carrier not found or not accessible in this scope");
  }

  /** SIP trunk must belong to this tenant (auto-scoped) and not be deleted. Returns its carrierId. */
  private async assertSipTrunkOwned(sipTrunkId: string): Promise<string> {
    const t = await this.prisma.scoped.sipTrunk.findFirst({ where: { id: sipTrunkId, deletedAt: null }, select: { carrierId: true } });
    if (!t) throw new BadRequestException("SIP trunk not found or not owned by this tenant");
    return t.carrierId;
  }

  private async assertRoutingProfileOwned(ctx: TenantContext, id: string): Promise<void> {
    const p = await this.prisma.routingProfile.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null }, select: { id: true } });
    if (!p) throw new BadRequestException("Routing profile not found or not owned by this tenant");
  }

  private async assertRegionExists(id: string): Promise<void> {
    const r = await this.prisma.region.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!r) throw new BadRequestException("Referenced region does not exist");
  }
}
