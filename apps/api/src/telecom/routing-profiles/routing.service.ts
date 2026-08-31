import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RoutingDestinationType, TenantType } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import { systemOrTenantWhere } from "@/authz/tenant-scope";
import { cursorArgs, toPage } from "@/common/pagination";
import { normalizeE164 } from "../dids/e164";
import type { CreateRoutingProfileInput, ListRoutingProfilesInput, RuleInputType, UpdateRoutingProfileInput } from "./routing.dto";

const PROFILE_INCLUDE = { rules: { where: { deletedAt: null }, orderBy: [{ priority: "asc" }, { id: "asc" }] } } satisfies Prisma.RoutingProfileInclude;
type ProfileRow = Prisma.RoutingProfileGetPayload<{ include: typeof PROFILE_INCLUDE }>;

/**
 * Routing profile foundation (Phase 12H) — DECLARATIVE CONFIGURATION ONLY.
 * NOTHING is executed: no SIP, no webhooks, no failover, no LCR. Profiles are
 * strictly tenant-owned (auto-scoped). Rules are managed embedded in the
 * profile; ordering is deterministic (priority ASC, then id ASC).
 */
@Injectable()
export class RoutingProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  private isPlatform(ctx: TenantContext): boolean {
    return ctx.tenantType === TenantType.PLATFORM;
  }

  private view(p: ProfileRow) {
    return {
      id: p.id,
      name: p.name,
      direction: p.direction,
      description: p.description,
      status: p.status,
      rules: p.rules.map((r) => ({
        id: r.id,
        destinationType: r.destinationType,
        destination: r.destination,
        priority: r.priority,
        enabled: r.enabled,
        timeoutSeconds: r.timeoutSeconds,
        retryCount: r.retryCount,
        carrierId: r.carrierId,
        failoverDestination: r.failoverDestination,
        failoverAfterSeconds: r.failoverAfterSeconds,
        schedule: r.schedule,
      })),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  async list(_ctx: TenantContext, f: ListRoutingProfilesInput) {
    const where: Prisma.RoutingProfileWhereInput = { deletedAt: null };
    if (f.status) where.status = f.status;
    if (f.direction) where.direction = f.direction;
    if (f.q) where.name = { contains: f.q, mode: "insensitive" };
    const rows = await this.prisma.scoped.routingProfile.findMany({ where, include: PROFILE_INCLUDE, ...cursorArgs(f.limit, f.cursor) });
    const { items, nextCursor } = toPage(rows, f.limit);
    return { items: items.map((r) => this.view(r)), nextCursor };
  }

  private async load(id: string): Promise<ProfileRow> {
    const p = await this.prisma.scoped.routingProfile.findFirst({ where: { id, deletedAt: null }, include: PROFILE_INCLUDE });
    if (!p) throw new NotFoundException("Routing profile not found");
    return p;
  }

  async get(_ctx: TenantContext, id: string) {
    return this.view(await this.load(id));
  }

  async create(ctx: TenantContext, input: CreateRoutingProfileInput) {
    const ruleData = await this.buildRules(ctx, input.rules ?? []);
    try {
      const p = await this.prisma.scoped.routingProfile.create({
        data: {
          tenantId: ctx.tenantId, // server-derived; scoped client re-asserts it
          name: input.name,
          direction: input.direction,
          description: input.description,
          status: input.status,
          rules: { create: ruleData },
        },
        include: PROFILE_INCLUDE,
      });
      return this.view(p);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("A routing profile with this name already exists");
      }
      throw e;
    }
  }

  async update(ctx: TenantContext, id: string, input: UpdateRoutingProfileInput) {
    const current = await this.load(id); // scoped → 404 for foreign tenant
    const rulesReplace = input.rules !== undefined ? await this.buildRules(ctx, input.rules) : undefined;

    const data: Prisma.RoutingProfileUncheckedUpdateInput = {};
    if ("name" in input) data.name = input.name;
    if ("direction" in input) data.direction = input.direction;
    if ("description" in input) data.description = input.description;
    if ("status" in input) data.status = input.status;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.routingProfile.update({ where: { id }, data });
        if (rulesReplace !== undefined) {
          await tx.routingRule.deleteMany({ where: { routingProfileId: id } });
          if (rulesReplace.length) await tx.routingRule.createMany({ data: rulesReplace.map((r) => ({ ...r, routingProfileId: id })) });
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("A routing profile with this name already exists");
      }
      throw e;
    }
    void current;
    return this.get(ctx, id);
  }

  async remove(ctx: TenantContext, id: string) {
    await this.load(id); // scoped ownership check → 404 for foreign tenant
    await this.prisma.routingProfile.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Validate + normalize each rule (relationships, timezone, canonical E.164). */
  private async buildRules(ctx: TenantContext, rules: RuleInputType[]): Promise<Prisma.RoutingRuleCreateManyRoutingProfileInput[]> {
    const out: Prisma.RoutingRuleCreateManyRoutingProfileInput[] = [];
    for (const r of rules) {
      let destination = r.destination;
      if (r.destinationType === RoutingDestinationType.PHONE_NUMBER) {
        const n = normalizeE164(r.destination);
        if (!n.ok) throw new BadRequestException(`Invalid destination number: ${n.reason}`);
        destination = n.value.e164; // store canonical
      }
      if (r.destinationType === RoutingDestinationType.SIP_TRUNK) {
        await this.assertSipTrunkOwned(r.destination);
      }
      if (r.carrierId) await this.assertCarrierAccessible(ctx, r.carrierId);
      if (r.schedule) this.assertTimezone(r.schedule.timezone);
      out.push({
        destinationType: r.destinationType,
        destination,
        priority: r.priority,
        enabled: r.enabled,
        timeoutSeconds: r.timeoutSeconds,
        retryCount: r.retryCount,
        carrierId: r.carrierId,
        failoverDestination: r.failoverDestination,
        failoverAfterSeconds: r.failoverAfterSeconds,
        schedule: r.schedule ? (r.schedule as Prisma.InputJsonValue) : undefined,
      });
    }
    return out;
  }

  private async assertSipTrunkOwned(sipTrunkId: string): Promise<void> {
    const t = await this.prisma.scoped.sipTrunk.findFirst({ where: { id: sipTrunkId, deletedAt: null }, select: { id: true } });
    if (!t) throw new BadRequestException("SIP trunk destination not found or not owned by this tenant");
  }

  private async assertCarrierAccessible(ctx: TenantContext, carrierId: string): Promise<void> {
    const c = await this.prisma.carrier.findFirst({ where: { id: carrierId, deletedAt: null, ...systemOrTenantWhere(ctx.tenantId) }, select: { id: true } });
    if (!c) throw new BadRequestException("Carrier not found or not accessible in this scope");
  }

  /** Validate an IANA timezone using the platform Intl (no extra dependency). */
  private assertTimezone(tz: string): void {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      throw new BadRequestException(`Invalid timezone: ${tz}`);
    }
  }
}
