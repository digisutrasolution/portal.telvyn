import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { TenantContext } from "./tenant-context";
import { isAuthorized } from "./authorization";
import { PERMISSIONS_KEY } from "./authz.decorators";

/**
 * Deny-by-default RBAC gate. Reads the route's @RequirePermissions and checks
 * them against the tenant context's expanded permission set. Runs after
 * JwtAuthGuard + TenantGuard.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ tenantContext?: TenantContext }>();
    const ctx = req.tenantContext;
    if (!ctx) throw new ForbiddenException("Missing tenant context");

    if (!isAuthorized(ctx.permissions, required)) {
      throw new ForbiddenException(`Missing required permission(s): ${required.join(", ")}`);
    }
    return true;
  }
}
