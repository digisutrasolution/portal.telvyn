import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { HealthStatus, Prisma } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { CreateNodeInput, UpdateNodeInput } from "../infra.dto";

type NodeWithHealth = Prisma.TelecomNodeGetPayload<{ include: { health: true } }>;

/**
 * Platform telecom nodes (ADR-0010). Configuration is durable; the health
 * snapshot is runtime (starts UNKNOWN, populated by the health framework in a
 * later phase). Platform-global — not tenant-scoped.
 */
@Injectable()
export class NodesService {
  constructor(private readonly prisma: PrismaService) {}

  private view(n: NodeWithHealth) {
    return {
      id: n.id,
      name: n.name,
      engineId: n.engineId,
      regionId: n.regionId,
      zone: n.zone,
      environment: n.environment,
      hostRef: n.hostRef,
      status: n.status,
      version: n.version,
      maxCps: n.maxCps,
      maxConcurrentCalls: n.maxConcurrentCalls,
      health: n.health
        ? { status: n.health.status, latencyMs: n.health.latencyMs, lastHeartbeatAt: n.health.lastHeartbeatAt }
        : { status: HealthStatus.UNKNOWN, latencyMs: null, lastHeartbeatAt: null },
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    };
  }

  async list() {
    const rows = await this.prisma.telecomNode.findMany({
      where: { deletedAt: null },
      include: { health: true },
      orderBy: { name: "asc" },
      take: 500,
    });
    return rows.map((n) => this.view(n));
  }

  async get(id: string) {
    const n = await this.prisma.telecomNode.findFirst({ where: { id, deletedAt: null }, include: { health: true } });
    if (!n) throw new NotFoundException("Node not found");
    return this.view(n);
  }

  async getHealth(id: string) {
    const view = await this.get(id);
    return view.health;
  }

  async create(input: CreateNodeInput) {
    await this.assertEngineExists(input.engineId);
    if (input.regionId) await this.assertRegionExists(input.regionId);
    // Relation connects (not scalar FKs) because we also nest the health create.
    const n = await this.prisma.telecomNode.create({
      data: {
        name: input.name,
        engine: { connect: { id: input.engineId } },
        region: input.regionId ? { connect: { id: input.regionId } } : undefined,
        zone: input.zone,
        environment: input.environment,
        hostRef: input.hostRef,
        status: input.status,
        version: input.version,
        maxCps: input.maxCps,
        maxConcurrentCalls: input.maxConcurrentCalls,
        // Honest UNKNOWN health snapshot (1:1) — populated by the health framework (12I).
        health: { create: { status: HealthStatus.UNKNOWN } },
      },
      include: { health: true },
    });
    return this.view(n);
  }

  async update(id: string, input: UpdateNodeInput) {
    await this.getRaw(id);
    if (input.regionId) await this.assertRegionExists(input.regionId);
    const n = await this.prisma.telecomNode.update({ where: { id }, data: { ...input }, include: { health: true } });
    return this.view(n);
  }

  async remove(id: string) {
    await this.getRaw(id);
    await this.prisma.telecomNode.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async getRaw(id: string) {
    const n = await this.prisma.telecomNode.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!n) throw new NotFoundException("Node not found");
    return n;
  }

  private async assertEngineExists(id: string): Promise<void> {
    const e = await this.prisma.telecomEngine.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!e) throw new BadRequestException("Referenced engine does not exist");
  }

  private async assertRegionExists(id: string): Promise<void> {
    const r = await this.prisma.region.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!r) throw new BadRequestException("Referenced region does not exist");
  }
}
