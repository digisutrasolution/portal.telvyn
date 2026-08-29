import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { HealthStatus, Prisma, TelecomCredentialType, TenantType } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "@/authz/tenant-context";
import { systemOrTenantWhere } from "@/authz/tenant-scope";
import { cursorArgs, toPage } from "@/common/pagination";
import { TelecomCredentialService, type CredentialScopeCtx } from "../secrets/telecom-credential.service";
import type { CreateSipTrunkInput, ListSipTrunksInput, UpdateSipTrunkInput } from "./sip-trunks.dto";

// Credential is included with an explicit SELECT that OMITS `secretEnc`.
const TRUNK_INCLUDE = {
  credential: { select: { id: true, type: true, label: true, hint: true, tenantId: true } },
  carrier: { select: { id: true, name: true, tenantId: true } },
} satisfies Prisma.SipTrunkInclude;

type TrunkRow = Prisma.SipTrunkGetPayload<{ include: typeof TRUNK_INCLUDE }>;

/**
 * SIP trunk foundation (Phase 12F) — control-plane configuration only; NO live
 * connectivity. Trunks are strictly tenant-owned, so all trunk access goes
 * through the auto-scoping client (`prisma.scoped.sipTrunk`) which injects the
 * server-derived tenantId and makes foreign ids resolve to not-found (IDOR).
 * Carrier accessibility (own or system) and credential ownership/type are
 * validated server-side; secrets stay in the vault (ADR-0009).
 */
@Injectable()
export class SipTrunksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: TelecomCredentialService,
  ) {}

  private scope(ctx: TenantContext): CredentialScopeCtx {
    return { tenantId: ctx.tenantId, isPlatform: ctx.tenantType === TenantType.PLATFORM };
  }

  private view(t: TrunkRow) {
    return {
      id: t.id,
      name: t.name,
      carrierId: t.carrierId,
      carrier: t.carrier ? { id: t.carrier.id, name: t.carrier.name, scope: t.carrier.tenantId === null ? "SYSTEM" : "TENANT" } : null,
      direction: t.direction,
      sipUri: t.sipUri,
      host: t.host,
      port: t.port,
      transport: t.transport,
      tls: t.tls,
      authMode: t.authMode,
      allowedIps: t.allowedIps,
      codecs: t.codecs,
      srtp: t.srtp,
      dtmfMode: t.dtmfMode,
      maxCps: t.maxCps,
      maxConcurrentCalls: t.maxConcurrentCalls,
      status: t.status, // administrative status (distinct from health)
      credential: t.credential
        ? { id: t.credential.id, type: t.credential.type, label: t.credential.label, hint: t.credential.hint }
        : null,
      // Honest: no trunk health probe exists (no live connectivity in 12F).
      health: { status: HealthStatus.UNKNOWN, detail: "no health check configured" },
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  async list(ctx: TenantContext, f: ListSipTrunksInput) {
    const where: Prisma.SipTrunkWhereInput = { deletedAt: null };
    if (f.status) where.status = f.status;
    if (f.direction) where.direction = f.direction;
    if (f.transport) where.transport = f.transport;
    if (f.carrierId) where.carrierId = f.carrierId;
    if (f.q) where.name = { contains: f.q, mode: "insensitive" };
    // Scoped client injects tenantId → only this tenant's trunks.
    const rows = await this.prisma.scoped.sipTrunk.findMany({ where, include: TRUNK_INCLUDE, ...cursorArgs(f.limit, f.cursor) });
    const { items, nextCursor } = toPage(rows, f.limit);
    return { items: items.map((r) => this.view(r)), nextCursor };
  }

  async get(_ctx: TenantContext, id: string) {
    // Scoped unique-read wraps `where` in AND {tenantId} → foreign id = not found.
    const t = await this.prisma.scoped.sipTrunk.findFirst({ where: { id, deletedAt: null }, include: TRUNK_INCLUDE });
    if (!t) throw new NotFoundException("SIP trunk not found");
    return this.view(t);
  }

  async create(ctx: TenantContext, input: CreateSipTrunkInput) {
    const scope = this.scope(ctx);
    await this.assertCarrierAccessible(scope, input.carrierId);
    const credentialId = await this.resolveCredential(scope, input);
    // tenantId is server-derived; the scoped client re-asserts it at runtime.
    const t = await this.prisma.scoped.sipTrunk.create({
      data: {
        tenantId: ctx.tenantId,
        carrierId: input.carrierId,
        name: input.name,
        direction: input.direction,
        sipUri: input.sipUri,
        host: input.host,
        port: input.port,
        transport: input.transport,
        tls: input.tls,
        authMode: input.authMode,
        allowedIps: input.allowedIps ?? [],
        codecs: input.codecs ?? [],
        srtp: input.srtp,
        dtmfMode: input.dtmfMode,
        maxCps: input.maxCps,
        maxConcurrentCalls: input.maxConcurrentCalls,
        status: input.status,
        credentialId,
      },
      include: TRUNK_INCLUDE,
    });
    return this.view(t);
  }

  async update(ctx: TenantContext, id: string, input: UpdateSipTrunkInput) {
    const scope = this.scope(ctx);
    await this.get(ctx, id); // scoped existence/ownership check (404 for foreign)
    if (input.carrierId) await this.assertCarrierAccessible(scope, input.carrierId);

    const { credentialId: _cid, credential: _inline, ...scalars } = input;
    const data: Prisma.SipTrunkUncheckedUpdateInput = { ...scalars };
    const resolved = await this.resolveCredential(scope, input);
    if (resolved !== undefined) data.credentialId = resolved;
    // tenantId is never in the DTO → ownership/scope is immutable. Ownership was
    // verified by the scoped get() above, so the raw update-by-id is safe.

    const t = await this.prisma.sipTrunk.update({ where: { id }, data, include: TRUNK_INCLUDE });
    return this.view(t);
  }

  async remove(ctx: TenantContext, id: string) {
    await this.get(ctx, id); // scoped ownership check → 404 for foreign tenant
    await this.prisma.sipTrunk.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Carrier must exist, not be deleted, and be accessible in the caller's scope (own or system). */
  private async assertCarrierAccessible(scope: CredentialScopeCtx, carrierId: string): Promise<void> {
    const c = await this.prisma.carrier.findFirst({
      where: { id: carrierId, deletedAt: null, ...systemOrTenantWhere(scope.tenantId) },
      select: { id: true },
    });
    if (!c) throw new BadRequestException("Carrier not found or not accessible in this scope");
  }

  /** Resolve a SIP credential reference or inline creation (forced SIP_PASSWORD). */
  private async resolveCredential(
    scope: CredentialScopeCtx,
    input: { credentialId?: string; credential?: { label: string; hint?: string; secret: string } },
  ): Promise<string | undefined> {
    if (input.credentialId) return this.vault.assertAttachable(input.credentialId, scope, TelecomCredentialType.SIP_PASSWORD);
    if (input.credential) return (await this.vault.create(scope, { ...input.credential, type: TelecomCredentialType.SIP_PASSWORD })).id;
    return undefined;
  }
}
