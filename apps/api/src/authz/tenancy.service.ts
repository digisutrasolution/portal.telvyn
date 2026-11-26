import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import { assertNoWildcardExcludedAssignment, WildcardExcludedAssignmentError } from "./authorization";
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

  /**
   * Self-scoped authorization context for the current session (Phase 12O-2a).
   * Identity + active tenant + the membership's roles + the expanded concrete
   * permission keys. Everything derives from the server-built TenantContext
   * (ADR-0004) — never a client-supplied id — so there is no IDOR surface and
   * no permission gate is needed beyond an authenticated, active membership.
   * The base client (not the scoped one) is used deliberately so system roles
   * (tenantId = null) held by the membership are included.
   */
  async memberContext(ctx: TenantContext) {
    const roles = await this.prisma.role.findMany({
      where: { deletedAt: null, membershipRoles: { some: { membershipId: ctx.membershipId } } },
      select: { id: true, key: true, name: true, isSystem: true },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
    return {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      tenantType: ctx.tenantType,
      roles,
      permissions: [...ctx.permissions].sort(),
    };
  }

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
      select: { id: true, permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (validRoles.length !== roleIds.length) throw new ConflictException("One or more roles are invalid for this tenant");
    // BA-08 / owner decision G4: a role conferring a high-risk financial permission
    // cannot be assigned in S1 (fail closed until the governed path exists).
    try {
      assertNoWildcardExcludedAssignment(validRoles.flatMap((r) => r.permissions.map((p) => p.permission.key)));
    } catch (e) {
      if (e instanceof WildcardExcludedAssignmentError) throw new ForbiddenException(e.message);
      throw e;
    }

    await this.prisma.$transaction([
      this.prisma.membershipRole.deleteMany({ where: { membershipId } }),
      this.prisma.membershipRole.createMany({ data: validRoles.map((r) => ({ membershipId, roleId: r.id })) }),
    ]);
    return this.listMembers();
  }
}
