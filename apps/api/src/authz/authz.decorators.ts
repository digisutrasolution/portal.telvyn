import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { TenantContext } from "./tenant-context";

export const PERMISSIONS_KEY = "required_permissions";

/** Declare the permissions a route requires (deny-by-default; all must be held). */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Inject the server-derived tenant context into a handler parameter. */
export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): TenantContext => {
  const req = ctx.switchToHttp().getRequest<{ tenantContext: TenantContext }>();
  return req.tenantContext;
});
