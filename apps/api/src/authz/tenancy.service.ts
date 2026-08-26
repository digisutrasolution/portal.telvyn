import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import type { TenantContext } from "./tenant-context";

/**
 * Tenant + membership operations. Reads/writes of tenant-owned models go
 * through the scoped client; the current tenant is used, never a client-
 * supplied id. Global lookups (tenant-by-id at login, user-by-email) use the
 * base client deliberately and are not exposed to tenant routes.
 */
@Injectable()
export class TenancyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Current tenant profile (scoped: id comes from context, not the request). */
  async currentTenant(ctx: TenantContext) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    return { id: tenant.id, slug: tenant.slug, name: tenant.name, type: tenant.type, status: tenant.status };
  }

  async updateCurrentTenant(ctx: TenantContext, name: string) {
    const tenant = await this.prisma.tenant.update({ where: { id: ctx.tenantId }, data: { name } });
    return { id: tenant.id, slug: tenant.slug, name: tenant.name, type: tenant.type, status: tenant.status };
  }

  /** Members of the CURRENT tenant (scoped) — a foreign tenantId cannot be requested. */
  async listMembers() {
    const memberships = await this.prisma.scoped.membership.findMany({
      where: { deletedAt: null },
      include: {
        user: { select: { id: true, email: true, fullName: true, status: true } },
        roles: { include: { role: { select: { id: true, key: true, name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((m) => ({
      membershipId: m.id,
      status: m.status,
      user: m.user,
      roles: m.roles.map((r) => r.role),
    }));
  }

  /** Assign roles to a member of the CURRENT tenant. Roles must belong to this tenant or be system roles. */
  async setMemberRoles(ctx: TenantContext, membershipId: string, roleIds: string[]) {
    // Scoped read: a membershipId from another tenant resolves to null → 404 (IDOR).
    const membership = await this.prisma.scoped.membership.findFirst({ where: { id: membershipId, deletedAt: null } });
    if (!membership) throw new NotFoundException("Member not found");

    // Only roles valid for this tenant (system roles or this tenant's custom roles).
    const validRoles = await this.prisma.role.findMany({
      where: { id: { in: roleIds }, deletedAt: null, OR: [{ tenantId: ctx.tenantId }, { isSystem: true, tenantId: null }] },
      select: { id: true },
    });
    if (validRoles.length !== roleIds.length) throw new ConflictException("One or more roles are invalid for this tenant");

    await this.prisma.$transaction([
      this.prisma.membershipRole.deleteMany({ where: { membershipId } }),
      this.prisma.membershipRole.createMany({ data: validRoles.map((r) => ({ membershipId, roleId: r.id })) }),
    ]);
    return this.listMembers();
  }
}
