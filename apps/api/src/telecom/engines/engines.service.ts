import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import { EngineRegistryService } from "./engine-registry.service";
import type { CreateEngineInput, SetEngineCapabilitiesInput, UpdateEngineInput } from "../infra.dto";

type EngineWithCaps = Prisma.TelecomEngineGetPayload<{ include: { capabilities: true } }>;

/** Platform telecom engine registry (ADR-0007). Platform-global. */
@Injectable()
export class EnginesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: EngineRegistryService,
  ) {}

  /** Enrich the config row with honest adapter metadata (software profile + live health). */
  private async view(e: EngineWithCaps) {
    const adapter = this.registry.getAdapter(e.type);
    const health = await adapter.healthCheck();
    return {
      id: e.id,
      name: e.name,
      type: e.type,
      provider: e.provider,
      version: e.version,
      endpoint: e.endpoint,
      environment: e.environment,
      regionId: e.regionId,
      status: e.status,
      // configured (admin-enabled) capabilities for THIS engine instance
      capabilities: e.capabilities.map((c) => c.capability),
      // honest metadata from the adapter (ADR-0007) — software profile, not fabricated
      softwareCapabilities: adapter.describeCapabilities(),
      implemented: adapter.implemented,
      health, // UNKNOWN until a real adapter + health probe exist (12I)
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }

  async list() {
    const rows = await this.prisma.telecomEngine.findMany({
      where: { deletedAt: null },
      include: { capabilities: true },
      orderBy: { name: "asc" },
      take: 500,
    });
    return Promise.all(rows.map((e) => this.view(e)));
  }

  async get(id: string) {
    const e = await this.prisma.telecomEngine.findFirst({ where: { id, deletedAt: null }, include: { capabilities: true } });
    if (!e) throw new NotFoundException("Engine not found");
    return this.view(e);
  }

  async create(input: CreateEngineInput) {
    if (input.regionId) await this.assertRegionExists(input.regionId);
    const e = await this.prisma.telecomEngine.create({ data: { ...input }, include: { capabilities: true } });
    return this.view(e);
  }

  async update(id: string, input: UpdateEngineInput) {
    await this.getRaw(id);
    if (input.regionId) await this.assertRegionExists(input.regionId);
    const e = await this.prisma.telecomEngine.update({ where: { id }, data: { ...input }, include: { capabilities: true } });
    return this.view(e);
  }

  async remove(id: string) {
    await this.getRaw(id);
    await this.prisma.telecomEngine.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Replace an engine's enabled capability set (admin-configured, per instance). */
  async setCapabilities(id: string, input: SetEngineCapabilitiesInput) {
    const engine = await this.getRaw(id);
    const unique = [...new Set(input.capabilities)];
    await this.prisma.$transaction([
      this.prisma.engineCapability.deleteMany({ where: { engineId: engine.id } }),
      this.prisma.engineCapability.createMany({
        data: unique.map((capability) => ({ engineId: engine.id, capability })),
      }),
    ]);
    return this.get(id);
  }

  private async getRaw(id: string) {
    const e = await this.prisma.telecomEngine.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!e) throw new NotFoundException("Engine not found");
    return e;
  }

  private async assertRegionExists(id: string): Promise<void> {
    const r = await this.prisma.region.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!r) throw new BadRequestException("Referenced region does not exist");
  }
}
