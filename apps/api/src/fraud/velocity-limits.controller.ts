import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { requestContext } from "@/common/request-context";
import { ZodPipe } from "@/common/zod.pipe";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { TenantGuard } from "@/authz/tenant.guard";
import { PermissionGuard } from "@/authz/permission.guard";
import { CurrentTenant, RequirePermissions } from "@/authz/authz.decorators";
import type { TenantContext } from "@/authz/tenant-context";
import { AuditService } from "@/authz/audit.service";
import { VelocityLimitsService } from "./velocity-limits.service";
import {
  CreateVelocityLimitDto,
  UpdateVelocityLimitDto,
  ListVelocityLimitsQuery,
  type CreateVelocityLimitInput,
  type UpdateVelocityLimitInput,
  type ListVelocityLimitsInput,
} from "./velocity-limits.dto";

/**
 * Velocity-limit API (Phase 12R-2b, ADR-0021). Tenant-authored fraud-policy
 * config — DECLARATIVE only (nothing enforces these yet). JWT + tenant +
 * permission gated; isolation is enforced by the tenant-scoping client. Reads
 * need `fraud.policy.read`; writes need `fraud.policy.manage`, and every
 * mutation is audited.
 */
@Controller("v1/fraud/policies/velocity-limits")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class VelocityLimitsController {
  constructor(
    private readonly limits: VelocityLimitsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("fraud.policy.read")
  list(@CurrentTenant() ctx: TenantContext, @Query(new ZodPipe(ListVelocityLimitsQuery)) query: ListVelocityLimitsInput) {
    return this.limits.list(ctx, query);
  }

  @Get(":id")
  @RequirePermissions("fraud.policy.read")
  get(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.limits.get(ctx, id);
  }

  @Post()
  @RequirePermissions("fraud.policy.manage")
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(CreateVelocityLimitDto)) body: CreateVelocityLimitInput,
    @Req() req: Request,
  ) {
    const limit = await this.limits.create(ctx, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "fraud.velocity_limit.created",
      resource: "velocity_limit",
      resourceId: limit.id,
      metadata: { metric: limit.metric, limit: limit.limit, enabled: limit.enabled },
    });
    return limit;
  }

  @Patch(":id")
  @RequirePermissions("fraud.policy.manage")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateVelocityLimitDto)) body: UpdateVelocityLimitInput,
    @Req() req: Request,
  ) {
    const limit = await this.limits.update(ctx, id, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "fraud.velocity_limit.updated",
      resource: "velocity_limit",
      resourceId: id,
      metadata: { limit: limit.limit, enabled: limit.enabled },
    });
    return limit;
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("fraud.policy.manage")
  async remove(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.limits.remove(ctx, id);
    await this.audit.log({ ctx, req: requestContext(req), action: "fraud.velocity_limit.deleted", resource: "velocity_limit", resourceId: id });
  }
}
