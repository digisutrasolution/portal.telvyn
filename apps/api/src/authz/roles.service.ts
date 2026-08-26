import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import { ALL_PERMISSION_KEYS } from "./permission-catalog";
import { expandGrants } from "./authorization";
import type { TenantContext } from "./tenant-context";

/** Role management — system roles (read-only templates) + tenant custom roles. */
@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /** System roles + this tenant's custom roles, with their permission keys. */
  async list(ctx: TenantContext) {
    const roles = await this.prisma.role.findMany({
      where: { deletedAt: null, OR: [{ tenantId: null, isSystem: true }, { tenantId: ctx.tenantId }] },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions.map((p) => p.permission.key),
    }));
  }

  /** Create a CUSTOM role for the current tenant from a concrete permission set. */
  async create(ctx: TenantContext, input: { key: string; name: string; description?: string; permissions: string[] }) {
    // A custom role may only grant permissions that exist AND that the creator holds
    // (prevents privilege escalation beyond one's own grants).
    const requested = expandGrants(input.permissions);
    const unknown = requested.filter((p) => !ALL_PERMISSION_KEYS.includes(p));
    if (unknown.length) throw new BadRequestException(`Unknown permissions: ${unknown.join(", ")}`);
    const beyond = requested.filter((p) => !ctx.permissions.has(p));
    if (beyond.length) throw new ForbiddenException(`Cannot grant permissions you do not hold: ${beyond.join(", ")}`);

    const existing = await this.prisma.role.findFirst({
      where: { tenantId: ctx.tenantId, key: input.key, deletedAt: null },
    });
    if (existing) throw new BadRequestException("A role with this key already exists");

    const permRows = await this.prisma.permission.findMany({ where: { key: { in: requested } }, select: { id: true } });
    const role = await this.prisma.role.create({
      data: {
        tenantId: ctx.tenantId,
        key: input.key,
        name: input.name,
        description: input.description,
        isSystem: false,
        permissions: { create: permRows.map((p) => ({ permissionId: p.id })) },
      },
    });
    return { id: role.id, key: role.key, name: role.name, permissions: requested };
  }

  /** Delete a custom role of the current tenant. System roles cannot be deleted. */
  async remove(ctx: TenantContext, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!role) throw new NotFoundException("Role not found");
    if (role.isSystem) throw new ForbiddenException("System roles cannot be deleted");
    await this.prisma.role.update({ where: { id: role.id }, data: { deletedAt: new Date() } });
  }
}
