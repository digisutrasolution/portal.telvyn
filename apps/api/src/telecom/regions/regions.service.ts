import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Region } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import type { CreateRegionInput, UpdateRegionInput } from "../infra.dto";

/** Platform regions (ADR-0010). Platform-global — not tenant-scoped. */
@Injectable()
export class RegionsService {
  constructor(private readonly prisma: PrismaService) {}

  private view(r: Region) {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      country: r.country,
      timezone: r.timezone,
      providerRegion: r.providerRegion,
      failoverRegionId: r.failoverRegionId,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async list() {
    const rows = await this.prisma.region.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, take: 500 });
    return rows.map((r) => this.view(r));
  }

  async get(id: string) {
    const r = await this.prisma.region.findFirst({ where: { id, deletedAt: null } });
    if (!r) throw new NotFoundException("Region not found");
    return this.view(r);
  }

  async create(input: CreateRegionInput) {
    const existing = await this.prisma.region.findFirst({ where: { code: input.code, deletedAt: null } });
    if (existing) throw new BadRequestException("A region with this code already exists");
    if (input.failoverRegionId) await this.assertRegionExists(input.failoverRegionId);
    const r = await this.prisma.region.create({ data: { ...input } });
    return this.view(r);
  }

  async update(id: string, input: UpdateRegionInput) {
    await this.get(id);
    if (input.failoverRegionId) {
      if (input.failoverRegionId === id) throw new BadRequestException("A region cannot fail over to itself");
      await this.assertRegionExists(input.failoverRegionId);
    }
    const r = await this.prisma.region.update({ where: { id }, data: { ...input } });
    return this.view(r);
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.region.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async assertRegionExists(id: string): Promise<void> {
    const r = await this.prisma.region.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!r) throw new BadRequestException("Referenced failover region does not exist");
  }
}
