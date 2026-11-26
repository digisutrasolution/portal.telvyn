import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import type { AuthedRequest } from "@/auth/jwt-auth.guard";
import { effectivePermissions, expandGrants } from "./authorization";
import { setTenantContext, type TenantContext } from "./tenant-context";

/**
 * Resolves the server-derived tenant context from the authenticated session's
 * `tid` claim (ADR-0004) — NEVER from request body/params/query. Re-verifies a
 * live membership on every request and loads the expanded permission set, then
 * runs the rest of the request inside the AsyncLocalStorage context so the
 * scoped Prisma client can enforce isolation. Runs after JwtAuthGuard.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest & { tenantContext?: TenantContext }>();
    const tenantId = req.auth.tid;
    if (!tenantId) throw new ForbiddenException("No active tenant for this session");

    // Membership is the authority — a revoked/suspended membership loses access
    // immediately, regardless of what the token claims.
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: req.auth.sub, tenantId } },
      include: {
        tenant: { select: { status: true, deletedAt: true, type: true } },
        user: { select: { mfaEnabled: true } },
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });

    if (
      !membership ||
      membership.status !== "ACTIVE" ||
      membership.deletedAt ||
      membership.tenant.deletedAt ||
      membership.tenant.status !== "ACTIVE"
    ) {
      throw new ForbiddenException("No active membership for this tenant");
    }

    const grants = membership.roles.flatMap((mr) => mr.role.permissions.map((rp) => rp.permission.key));
    const ctx: TenantContext = {
      userId: req.auth.sub,
      tenantId,
      tenantType: membership.tenant.type,
      membershipId: membership.id,
      // MFA-for-finance (BA-08): high-risk financial keys are effective only with MFA.
      permissions: effectivePermissions(expandGrants(grants), membership.user.mfaEnabled),
    };
    req.tenantContext = ctx;

    // Fill the request store (seeded by TenantContextMiddleware) so the scoped
    // Prisma client sees the context in the route handler.
    setTenantContext(ctx);
    return true;
  }
}
