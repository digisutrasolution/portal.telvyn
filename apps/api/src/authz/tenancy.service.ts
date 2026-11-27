import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import {
  assertNoWildcardExcludedAssignment,
  effectivePermissions,
  expandGrants,
  WildcardExcludedAssignmentError,
} from "./authorization";
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

  /**
   * Assign roles to a member of the CURRENT tenant (P1 escalation correction).
   * Roles must belong to this tenant or be system roles. Inside ONE transaction
   * that locks the tenant row (serializing every role change of the tenant):
   *  - the actor's authority is RE-DERIVED from the database (a concurrent
   *    demotion of the actor is honoured; the request-start context is not trusted);
   *  - self-modification is refused (no self-escalation, no self-lockout);
   *  - every permission the new roles confer must be held by the actor
   *    ("cannot grant what you do not hold" — `member.manage` alone confers no
   *    authority to hand out `owner`/`admin`);
   *  - a member holding any permission the actor lacks cannot be modified
   *    (protected roles: an admin cannot demote or strip an owner);
   *  - wildcard-excluded financial permissions are never assignable here (G4/BA-08);
   *  - the tenant always keeps at least one active owner.
   */
  async setMemberRoles(ctx: TenantContext, membershipId: string, roleIds: string[]) {
    // Scoped read: a membershipId from another tenant resolves to null → 404 (IDOR).
    const membership = await this.prisma.scoped.membership.findFirst({ where: { id: membershipId, deletedAt: null } });
    if (!membership) throw new NotFoundException("Member not found");
    if (membership.id === ctx.membershipId) throw new ForbiddenException("You cannot change your own roles");

    const wanted = [...new Set(roleIds)];
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "Tenant" WHERE "id" = ${ctx.tenantId}::uuid FOR UPDATE`;

      const actor = await this.authorityOf(tx, ctx.membershipId, ctx.tenantId);
      if (!actor || !actor.has("member.manage")) throw new ForbiddenException("Not authorized to manage members");

      // Only roles valid for this tenant (system roles or this tenant's custom roles).
      const validRoles = await tx.role.findMany({
        where: { id: { in: wanted }, deletedAt: null, OR: [{ tenantId: ctx.tenantId }, { isSystem: true, tenantId: null }] },
        select: { id: true, key: true, isSystem: true, permissions: { select: { permission: { select: { key: true } } } } },
      });
      if (validRoles.length !== wanted.length) throw new ConflictException("One or more roles are invalid for this tenant");
      const conferred = expandGrants(validRoles.flatMap((r) => r.permissions.map((p) => p.permission.key)));
      // BA-08 / owner decision G4: a role conferring a high-risk financial permission
      // is never assignable through ordinary member management.
      try {
        assertNoWildcardExcludedAssignment(conferred);
      } catch (e) {
        if (e instanceof WildcardExcludedAssignmentError) throw new ForbiddenException(e.message);
        throw e;
      }
      if (conferred.some((k) => !actor.has(k))) {
        throw new ForbiddenException("Cannot assign roles that grant permissions you do not hold");
      }

      // The target, re-read under the lock, with its current roles.
      const target = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: ctx.tenantId, deletedAt: null },
        select: {
          id: true,
          roles: { select: { role: { select: { key: true, isSystem: true, deletedAt: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
        },
      });
      if (!target) throw new NotFoundException("Member not found");
      const live = target.roles.filter((r) => !r.role.deletedAt);
      const current = expandGrants(live.flatMap((r) => r.role.permissions.map((p) => p.permission.key)));
      if (current.some((k) => !actor.has(k))) {
        throw new ForbiddenException("Cannot change the roles of a member who holds permissions you do not hold");
      }

      const wasOwner = live.some((r) => r.role.isSystem && r.role.key === "owner");
      const staysOwner = validRoles.some((r) => r.isSystem && r.key === "owner");
      if (wasOwner && !staysOwner) {
        const otherOwners = await tx.membership.count({
          where: {
            tenantId: ctx.tenantId,
            id: { not: membershipId },
            status: "ACTIVE",
            deletedAt: null,
            roles: { some: { role: { key: "owner", isSystem: true, tenantId: null, deletedAt: null } } },
          },
        });
        if (otherOwners === 0) throw new ConflictException("A tenant must keep at least one active owner");
      }

      await tx.membershipRole.deleteMany({ where: { membershipId } });
      await tx.membershipRole.createMany({ data: validRoles.map((r) => ({ membershipId, roleId: r.id })) });
    });
    return this.listMembers();
  }

  /**
   * Effective permissions of a membership, read from the database inside `tx`
   * (same derivation as TenantGuard: expand grants, MFA-for-finance). Null when
   * the membership or its tenant is no longer active.
   */
  async authorityOf(tx: Prisma.TransactionClient, membershipId: string, tenantId: string): Promise<Set<string> | null> {
    const m = await tx.membership.findFirst({
      where: { id: membershipId, tenantId, status: "ACTIVE", deletedAt: null },
      select: {
        user: { select: { mfaEnabled: true } },
        tenant: { select: { status: true, deletedAt: true } },
        roles: { select: { role: { select: { deletedAt: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
      },
    });
    if (!m || m.tenant.deletedAt || m.tenant.status !== "ACTIVE") return null;
    const grants = m.roles.filter((r) => !r.role.deletedAt).flatMap((r) => r.role.permissions.map((p) => p.permission.key));
    return effectivePermissions(expandGrants(grants), m.user.mfaEnabled);
  }
}
