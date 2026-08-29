import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { TenantType } from "@prisma/client";
import type { TenantContext } from "./tenant-context";

/**
 * Restricts a route to members acting under the PLATFORM tenant. Platform
 * telecom infrastructure (regions, engines, nodes, wholesale carriers) is
 * operator-owned; a customer/reseller tenant must never mutate or read it,
 * even if its role happens to hold the permission (e.g. an owner's `*`).
 * Runs AFTER JwtAuthGuard + TenantGuard (which populate the context).
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ tenantContext?: TenantContext }>();
    const ctx = req.tenantContext;
    if (!ctx) throw new ForbiddenException("Missing tenant context");
    if (ctx.tenantType !== TenantType.PLATFORM) {
      throw new ForbiddenException("Platform telecom infrastructure is restricted to the platform operator");
    }
    return true;
  }
}
