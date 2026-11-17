import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EngineResourceKind, Prisma, type TelecomEngineType } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { EngineConfigurationSource } from "./engine.service";
import type { AssignEngineResourceInput } from "../infra.dto";

/** Safe assignment view — ids + non-secret resource summary. */
export interface AssignmentView {
  id: string;
  engineId: string;
  kind: EngineResourceKind;
  tenantId: string | null;
  enabled: boolean;
  resource: { id: string; label: string };
  createdAt: Date;
  updatedAt: Date;
}

type ResourceRef = {
  tenantId: string | null;
  sipTrunkId?: string;
  didId?: string;
  routingProfileId?: string;
  label: string;
};

/**
 * Engine ↔ resource assignment (Phase 12N-2). Platform-managed: decides which
 * tenant/platform resources are deployed to which engine. Validation is
 * server-side — the resource must exist and match `kind`, and `tenantId` is
 * taken from the resource's owner (never from the client). Integrity (exactly one
 * resource, matching kind; one assignment per resource per engine) is also
 * enforced by the DB (ADR-0012).
 */
@Injectable()
export class EngineAssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async assign(engineId: string, input: AssignEngineResourceInput): Promise<AssignmentView> {
    await this.assertEngine(engineId);
    const ref = await this.resolveResource(input.kind, input.resourceId);
    const fkWhere = this.fkWhere(input.kind, input.resourceId);

    // One row per (engine, resource) exists at most — reactivate a prior one.
    const existing = await this.prisma.engineResourceAssignment.findFirst({ where: { engineId, ...fkWhere } });
    if (existing && existing.deletedAt === null) {
      throw new ConflictException("Resource is already assigned to this engine");
    }

    try {
      const row = existing
        ? await this.prisma.engineResourceAssignment.update({
            where: { id: existing.id },
            data: { kind: input.kind, tenantId: ref.tenantId, enabled: input.enabled ?? true, deletedAt: null },
          })
        : await this.prisma.engineResourceAssignment.create({
            data: {
              engineId,
              kind: input.kind,
              tenantId: ref.tenantId,
              sipTrunkId: ref.sipTrunkId,
              didId: ref.didId,
              routingProfileId: ref.routingProfileId,
              enabled: input.enabled ?? true,
            },
          });
      return this.view(row, ref.label);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Resource is already assigned to this engine");
      }
      throw e;
    }
  }

  async list(engineId: string): Promise<AssignmentView[]> {
    await this.assertEngine(engineId);
    const rows = await this.prisma.engineResourceAssignment.findMany({
      where: { engineId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: {
        sipTrunk: { select: { id: true, name: true } },
        did: { select: { id: true, e164: true } },
        routingProfile: { select: { id: true, name: true } },
      },
    });
    return rows.map((r) => this.view(r, this.labelFrom(r)));
  }

  async setEnabled(engineId: string, assignmentId: string, enabled: boolean): Promise<AssignmentView> {
    const existing = await this.getOwned(engineId, assignmentId);
    const row = await this.prisma.engineResourceAssignment.update({ where: { id: existing.id }, data: { enabled } });
    return this.view(row, await this.labelById(row));
  }

  async unassign(engineId: string, assignmentId: string): Promise<void> {
    const existing = await this.getOwned(engineId, assignmentId);
    await this.prisma.engineResourceAssignment.update({ where: { id: existing.id }, data: { deletedAt: new Date(), enabled: false } });
  }

  /**
   * Build the secret-free desired-configuration SOURCE for an engine from its
   * ENABLED, non-deleted assignments (Phase 12N-3). Soft-deleted resources are
   * excluded; carriers are derived from the assigned trunks'/DIDs' carriers
   * (no per-engine carrier ordering yet → priority 0). Deterministic order.
   */
  async buildConfigurationSource(engineId: string, engineType: TelecomEngineType): Promise<EngineConfigurationSource> {
    const rows = await this.prisma.engineResourceAssignment.findMany({
      where: { engineId, deletedAt: null, enabled: true },
      include: {
        sipTrunk: { select: { id: true, name: true, host: true, transport: true, credentialId: true, carrierId: true, deletedAt: true } },
        did: { select: { id: true, e164: true, carrierId: true, sipTrunkId: true, deletedAt: true } },
        routingProfile: { select: { id: true, deletedAt: true, rules: { select: { id: true, destinationType: true, priority: true } } } },
      },
    });

    const trunks: EngineConfigurationSource["trunks"] = [];
    const dids: EngineConfigurationSource["dids"] = [];
    const routes: EngineConfigurationSource["routes"] = [];
    const carrierIds = new Set<string>();

    for (const r of rows) {
      if (r.kind === EngineResourceKind.SIP_TRUNK && r.sipTrunk && r.sipTrunk.deletedAt === null) {
        const t = r.sipTrunk;
        trunks.push({ id: t.id, name: t.name, host: t.host, transport: String(t.transport), credentialId: t.credentialId });
        if (t.carrierId) carrierIds.add(t.carrierId);
      } else if (r.kind === EngineResourceKind.DID && r.did && r.did.deletedAt === null) {
        const d = r.did;
        dids.push({ id: d.id, e164: d.e164, carrierId: d.carrierId, sipTrunkId: d.sipTrunkId });
        if (d.carrierId) carrierIds.add(d.carrierId);
      } else if (r.kind === EngineResourceKind.ROUTING_PROFILE && r.routingProfile && r.routingProfile.deletedAt === null) {
        for (const rule of r.routingProfile.rules) {
          routes.push({ id: rule.id, destinationType: String(rule.destinationType), priority: rule.priority });
        }
      }
    }

    const carriers: EngineConfigurationSource["carriers"] = carrierIds.size
      ? (
          await this.prisma.carrier.findMany({ where: { id: { in: [...carrierIds] }, deletedAt: null }, select: { id: true, name: true, credentialId: true } })
        ).map((c) => ({ id: c.id, name: c.name, priority: 0, credentialId: c.credentialId }))
      : [];

    // The fingerprint is order-independent (ADR-0011), but keep snapshots stable.
    const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    trunks.sort(byId);
    dids.sort(byId);
    routes.sort(byId);
    carriers.sort(byId);

    return { engineType, carriers, trunks, dids, routes };
  }

  // --- helpers --------------------------------------------------------------

  private async assertEngine(engineId: string): Promise<void> {
    const e = await this.prisma.telecomEngine.findFirst({ where: { id: engineId, deletedAt: null }, select: { id: true } });
    if (!e) throw new NotFoundException("Engine not found");
  }

  private async getOwned(engineId: string, assignmentId: string) {
    await this.assertEngine(engineId);
    const a = await this.prisma.engineResourceAssignment.findFirst({ where: { id: assignmentId, engineId, deletedAt: null }, select: { id: true } });
    if (!a) throw new NotFoundException("Assignment not found");
    return a;
  }

  private fkWhere(kind: EngineResourceKind, resourceId: string): Prisma.EngineResourceAssignmentWhereInput {
    if (kind === EngineResourceKind.SIP_TRUNK) return { sipTrunkId: resourceId };
    if (kind === EngineResourceKind.DID) return { didId: resourceId };
    return { routingProfileId: resourceId };
  }

  /** Validate the resource exists + matches kind; return its FK + owner tenant. */
  private async resolveResource(kind: EngineResourceKind, resourceId: string): Promise<ResourceRef> {
    if (kind === EngineResourceKind.SIP_TRUNK) {
      const t = await this.prisma.sipTrunk.findFirst({ where: { id: resourceId, deletedAt: null }, select: { id: true, name: true, tenantId: true } });
      if (!t) throw new NotFoundException("SIP trunk not found");
      return { tenantId: t.tenantId, sipTrunkId: t.id, label: t.name };
    }
    if (kind === EngineResourceKind.DID) {
      const d = await this.prisma.did.findFirst({ where: { id: resourceId, deletedAt: null }, select: { id: true, e164: true, tenantId: true } });
      if (!d) throw new NotFoundException("DID not found");
      return { tenantId: d.tenantId, didId: d.id, label: d.e164 };
    }
    if (kind === EngineResourceKind.ROUTING_PROFILE) {
      const p = await this.prisma.routingProfile.findFirst({ where: { id: resourceId, deletedAt: null }, select: { id: true, name: true, tenantId: true } });
      if (!p) throw new NotFoundException("Routing profile not found");
      return { tenantId: p.tenantId, routingProfileId: p.id, label: p.name };
    }
    throw new BadRequestException("Unsupported resource kind");
  }

  private labelFrom(r: { kind: EngineResourceKind; sipTrunk?: { name: string } | null; did?: { e164: string } | null; routingProfile?: { name: string } | null }): string {
    if (r.kind === EngineResourceKind.SIP_TRUNK) return r.sipTrunk?.name ?? "(removed trunk)";
    if (r.kind === EngineResourceKind.DID) return r.did?.e164 ?? "(removed DID)";
    return r.routingProfile?.name ?? "(removed profile)";
  }

  private async labelById(row: { kind: EngineResourceKind; sipTrunkId: string | null; didId: string | null; routingProfileId: string | null }): Promise<string> {
    if (row.kind === EngineResourceKind.SIP_TRUNK && row.sipTrunkId) return (await this.prisma.sipTrunk.findUnique({ where: { id: row.sipTrunkId }, select: { name: true } }))?.name ?? "";
    if (row.kind === EngineResourceKind.DID && row.didId) return (await this.prisma.did.findUnique({ where: { id: row.didId }, select: { e164: true } }))?.e164 ?? "";
    if (row.kind === EngineResourceKind.ROUTING_PROFILE && row.routingProfileId) return (await this.prisma.routingProfile.findUnique({ where: { id: row.routingProfileId }, select: { name: true } }))?.name ?? "";
    return "";
  }

  private view(
    row: { id: string; engineId: string; kind: EngineResourceKind; tenantId: string | null; enabled: boolean; sipTrunkId: string | null; didId: string | null; routingProfileId: string | null; createdAt: Date; updatedAt: Date },
    label: string,
  ): AssignmentView {
    const resourceId = row.sipTrunkId ?? row.didId ?? row.routingProfileId ?? "";
    return {
      id: row.id,
      engineId: row.engineId,
      kind: row.kind,
      tenantId: row.tenantId,
      enabled: row.enabled,
      resource: { id: resourceId, label },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
