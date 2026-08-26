import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { requestContext } from "@/common/request-context";
import { ZodPipe } from "@/common/zod.pipe";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { TenantGuard } from "./tenant.guard";
import { PermissionGuard } from "./permission.guard";
import { CurrentTenant, RequirePermissions } from "./authz.decorators";
import type { TenantContext } from "./tenant-context";
import { TenancyService } from "./tenancy.service";
import { RolesService } from "./roles.service";
import { AuditService } from "./audit.service";
import { PERMISSIONS, PERMISSION_GROUPS } from "./permission-catalog";
import {
  UpdateTenantDto,
  SetMemberRolesDto,
  CreateRoleDto,
  type UpdateTenantInput,
  type SetMemberRolesInput,
  type CreateRoleInput,
} from "./authz.dto";

/**
 * Enterprise authorization surface. Every route is triple-gated:
 * JwtAuthGuard (authenticated) → TenantGuard (server-derived tenant context)
 * → PermissionGuard (deny-by-default RBAC). No route reads a tenant id from
 * the client; the tenant is always ctx.tenantId.
 */
@Controller("v1")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class AuthzController {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly roles: RolesService,
    private readonly audit: AuditService,
  ) {}

  // ---- catalog (any member may read the permission dictionary) ----
  @Get("permissions")
  @RequirePermissions("role.read")
  permissionCatalog() {
    return { groups: PERMISSION_GROUPS, permissions: PERMISSIONS };
  }

  // ---- tenant ----
  @Get("tenant")
  @RequirePermissions("tenant.read")
  getTenant(@CurrentTenant() ctx: TenantContext) {
    return this.tenancy.currentTenant(ctx);
  }

  @Put("tenant")
  @RequirePermissions("tenant.manage")
  async updateTenant(
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(UpdateTenantDto)) body: UpdateTenantInput,
    @Req() req: Request,
  ) {
    const result = await this.tenancy.updateCurrentTenant(ctx, body.name);
    await this.audit.log({ ctx, req: requestContext(req), action: "tenant.updated", resource: "tenant", resourceId: ctx.tenantId });
    return result;
  }

  // ---- members ----
  @Get("members")
  @RequirePermissions("member.read")
  listMembers() {
    return this.tenancy.listMembers();
  }

  @Put("members/:id/roles")
  @RequirePermissions("member.manage")
  async setMemberRoles(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) membershipId: string,
    @Body(new ZodPipe(SetMemberRolesDto)) body: SetMemberRolesInput,
    @Req() req: Request,
  ) {
    const result = await this.tenancy.setMemberRoles(ctx, membershipId, body.roleIds);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "membership.roles_set",
      resource: "membership",
      resourceId: membershipId,
      metadata: { roleIds: body.roleIds },
    });
    return result;
  }

  // ---- roles ----
  @Get("roles")
  @RequirePermissions("role.read")
  listRoles(@CurrentTenant() ctx: TenantContext) {
    return this.roles.list(ctx);
  }

  @Post("roles")
  @RequirePermissions("role.manage")
  async createRole(
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(CreateRoleDto)) body: CreateRoleInput,
    @Req() req: Request,
  ) {
    const role = await this.roles.create(ctx, body);
    await this.audit.log({ ctx, req: requestContext(req), action: "role.created", resource: "role", resourceId: role.id, metadata: { key: role.key } });
    return role;
  }

  @Delete("roles/:id")
  @HttpCode(204)
  @RequirePermissions("role.manage")
  async deleteRole(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.roles.remove(ctx, id);
    await this.audit.log({ ctx, req: requestContext(req), action: "role.deleted", resource: "role", resourceId: id });
  }

  // ---- audit trail ----
  @Get("audit-logs")
  @RequirePermissions("audit.read")
  auditLogs() {
    return this.audit.list();
  }
}
