import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { HealthEntityType, HealthStatus, Prisma, TenantType, type TelecomCredentialType } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import { authorizeDualNatureWrite, ownerTenantIdForCreate, systemOrTenantWhere } from "@/authz/tenant-scope";
import { cursorArgs, toPage } from "@/common/pagination";
import { TelecomCredentialService, type CredentialScopeCtx } from "../secrets/telecom-credential.service";
import type { CreateCarrierInput, ListCarriersInput, UpdateCarrierInput } from "./carriers.dto";

// Credential is included with an explicit SELECT that OMITS `secretEnc` — the
// encrypted secret can never enter a carrier query result set.
const CARRIER_INCLUDE = {
  credential: {
    select: { id: true, type: true, label: true, hint: true, tenantId: true, rotatedAt: true, createdAt: true, updatedAt: true },
  },
} satisfies Prisma.CarrierInclude;

type CarrierRow = Prisma.CarrierGetPayload<{ include: typeof CARRIER_INCLUDE }>;

/**
 * Carrier foundation (Phase 12E). Carriers are dual-nature (ADR-0008): system
 * (tenantId null, platform-owned) or tenant-owned. Scope is ALWAYS derived from
 * the authenticated context — never from client input. Secrets live in the
 * vault (ADR-0009); this service only ever handles a credentialId reference and
 * safe metadata.
 */
@Injectable()
export class CarriersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: TelecomCredentialService,
  ) {}

  private scope(ctx: TenantContext): CredentialScopeCtx {
    return { tenantId: ctx.tenantId, isPlatform: ctx.tenantType === TenantType.PLATFORM };
  }

  /**
   * Honest carrier health (Phase 12O-2aw) — derived from the latest CARRIER
   * HealthEvent (the operator probe writes those). UNKNOWN until first probed;
   * never fabricated. Carriers have no health snapshot table, so this is the
   * authoritative current status.
   */
  private deriveHealth(latest: HealthStatus | null): { status: HealthStatus; detail: string } {
    if (latest === null) return { status: HealthStatus.UNKNOWN, detail: "not yet probed" };
    return { status: latest, detail: "last operator health probe" };
  }

  /**
   * Latest CARRIER health status per carrier id (no N+1): one query over the listed
   * carriers' events, newest-first by the uuidv7 id, keeping the first (newest) seen
   * per carrier. Health events are transitions only (ADR-0010), so the row count is
   * small. Carriers never probed are simply absent from the map. (We cannot `max(id)`
   * — Postgres has no max() for uuid — so we order + dedupe in-process instead.)
   */
  private async latestHealthFor(ids: string[]): Promise<Map<string, HealthStatus>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.healthEvent.findMany({
      where: { entityType: HealthEntityType.CARRIER, entityId: { in: ids } },
      orderBy: { id: "desc" }, // uuidv7 id is time-ordered → newest first
      select: { entityId: true, toStatus: true },
    });
    const latest = new Map<string, HealthStatus>();
    for (const r of rows) if (!latest.has(r.entityId)) latest.set(r.entityId, r.toStatus);
    return latest;
  }

  private view(c: CarrierRow, latestHealth: HealthStatus | null = null) {
    return {
      id: c.id,
      scope: c.tenantId === null ? "SYSTEM" : "TENANT",
      name: c.name,
      type: c.type,
      country: c.country,
      regionId: c.regionId,
      status: c.status, // administrative status (distinct from health)
      priority: c.priority,
      codecs: c.codecs,
      maxCps: c.maxCps,
      maxConcurrentCalls: c.maxConcurrentCalls,
      credential: c.credential
        ? {
            id: c.credential.id,
            type: c.credential.type,
            label: c.credential.label,
            hint: c.credential.hint, // non-secret
            scope: c.credential.tenantId === null ? "SYSTEM" : "TENANT",
          }
        : null,
      health: this.deriveHealth(latestHealth),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  async list(ctx: TenantContext, f: ListCarriersInput) {
    const scope = this.scope(ctx);
    const where: Prisma.CarrierWhereInput = { deletedAt: null };
    if (f.scope === "system") where.tenantId = null;
    else if (f.scope === "tenant") where.tenantId = scope.tenantId;
    else Object.assign(where, systemOrTenantWhere(scope.tenantId)); // own + system

    if (f.status) where.status = f.status;
    if (f.regionId) where.regionId = f.regionId;
    if (f.q) where.name = { contains: f.q, mode: "insensitive" };

    const rows = await this.prisma.carrier.findMany({ where, include: CARRIER_INCLUDE, ...cursorArgs(f.limit, f.cursor) });
    const { items, nextCursor } = toPage(rows, f.limit);
    const health = await this.latestHealthFor(items.map((r) => r.id)); // page only, two bounded queries
    return { items: items.map((r) => this.view(r, health.get(r.id) ?? null)), nextCursor };
  }

  async get(ctx: TenantContext, id: string) {
    const scope = this.scope(ctx);
    // Visibility = own + system; a foreign-tenant carrier is simply not found.
    const c = await this.prisma.carrier.findFirst({
      where: { id, deletedAt: null, ...systemOrTenantWhere(scope.tenantId) },
      include: CARRIER_INCLUDE,
    });
    if (!c) throw new NotFoundException("Carrier not found");
    const latest = await this.prisma.healthEvent.findFirst({
      where: { entityType: HealthEntityType.CARRIER, entityId: c.id },
      orderBy: { id: "desc" },
      select: { toStatus: true },
    });
    return this.view(c, latest?.toStatus ?? null);
  }

  async create(ctx: TenantContext, input: CreateCarrierInput) {
    const scope = this.scope(ctx);
    if (input.regionId) await this.assertRegion(input.regionId);
    const credentialId = await this.resolveCredential(scope, input);
    const c = await this.prisma.carrier.create({
      data: {
        tenantId: ownerTenantIdForCreate(scope), // system (null) for platform, else own tenant
        name: input.name,
        type: input.type,
        country: input.country,
        regionId: input.regionId,
        status: input.status,
        priority: input.priority,
        codecs: input.codecs ?? [],
        maxCps: input.maxCps,
        maxConcurrentCalls: input.maxConcurrentCalls,
        credentialId,
      },
      include: CARRIER_INCLUDE,
    });
    return this.view(c);
  }

  async update(ctx: TenantContext, id: string, input: UpdateCarrierInput) {
    const scope = this.scope(ctx);
    await this.loadForWrite(scope, id); // enforces ownership/scope, throws 404/403
    if (input.regionId) await this.assertRegion(input.regionId);

    const { credentialId: _cid, credential: _inline, ...scalars } = input;
    const data: Prisma.CarrierUncheckedUpdateInput = { ...scalars };
    const resolved = await this.resolveCredential(scope, input);
    if (resolved !== undefined) data.credentialId = resolved; // change only when supplied
    // tenantId is never in the DTO → scope is immutable (no escalation).

    const c = await this.prisma.carrier.update({ where: { id }, data, include: CARRIER_INCLUDE });
    return this.view(c);
  }

  async remove(ctx: TenantContext, id: string) {
    const scope = this.scope(ctx);
    await this.loadForWrite(scope, id);
    // Soft delete — never cascade-destroy business/audit history.
    await this.prisma.carrier.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Load a carrier for a WRITE, enforcing dual-nature ownership (ADR-0008). */
  private async loadForWrite(scope: CredentialScopeCtx, id: string): Promise<{ id: string; tenantId: string | null }> {
    const c = await this.prisma.carrier.findFirst({ where: { id, deletedAt: null }, select: { id: true, tenantId: true } });
    if (!c) throw new NotFoundException("Carrier not found");
    const decision = authorizeDualNatureWrite(c.tenantId, scope);
    if (decision === "not_found") throw new NotFoundException("Carrier not found"); // foreign tenant → IDOR-safe
    if (decision === "forbidden_system") throw new ForbiddenException("System carriers are managed by the platform operator");
    return c;
  }

  /** Resolve a credential reference or inline creation to a credentialId (or undefined). */
  private async resolveCredential(
    scope: CredentialScopeCtx,
    input: {
      credentialId?: string;
      credential?: { type: TelecomCredentialType; label: string; hint?: string; secret: string };
    },
  ): Promise<string | undefined> {
    if (input.credentialId) return this.vault.assertAttachable(input.credentialId, scope);
    if (input.credential) return (await this.vault.create(scope, input.credential)).id;
    return undefined;
  }

  private async assertRegion(id: string): Promise<void> {
    const r = await this.prisma.region.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!r) throw new BadRequestException("Referenced region does not exist");
  }
}
