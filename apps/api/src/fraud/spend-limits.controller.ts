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
import { SpendLimitsService } from "./spend-limits.service";
import {
  CreateSpendLimitDto,
  UpdateSpendLimitDto,
  ListSpendLimitsQuery,
  type CreateSpendLimitInput,
  type UpdateSpendLimitInput,
  type ListSpendLimitsInput,
} from "./spend-limits.dto";

/**
 * Spend-limit API (Phase 12R-2a, ADR-0021). Tenant-authored fraud-policy config
 * — DECLARATIVE only (nothing enforces these yet). JWT + tenant + permission
 * gated; isolation is enforced by the tenant-scoping client, not a client field.
 * Reads need `fraud.policy.read`; writes need `fraud.policy.manage`, and every
 * mutation is audited.
 */
@Controller("v1/fraud/policies/spend-limits")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class SpendLimitsController {
  constructor(
    private readonly limits: SpendLimitsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("fraud.policy.read")
  list(@CurrentTenant() ctx: TenantContext, @Query(new ZodPipe(ListSpendLimitsQuery)) query: ListSpendLimitsInput) {
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
    @Body(new ZodPipe(CreateSpendLimitDto)) body: CreateSpendLimitInput,
    @Req() req: Request,
  ) {
    const limit = await this.limits.create(ctx, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "fraud.spend_limit.created",
      resource: "spend_limit",
      resourceId: limit.id,
      metadata: { period: limit.period, amountMicros: limit.amountMicros, currency: limit.currency, enabled: limit.enabled },
    });
    return limit;
  }

  @Patch(":id")
  @RequirePermissions("fraud.policy.manage")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateSpendLimitDto)) body: UpdateSpendLimitInput,
    @Req() req: Request,
  ) {
    const limit = await this.limits.update(ctx, id, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "fraud.spend_limit.updated",
      resource: "spend_limit",
      resourceId: id,
      metadata: { amountMicros: limit.amountMicros, currency: limit.currency, enabled: limit.enabled },
    });
    return limit;
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("fraud.policy.manage")
  async remove(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.limits.remove(ctx, id);
    await this.audit.log({ ctx, req: requestContext(req), action: "fraud.spend_limit.deleted", resource: "spend_limit", resourceId: id });
  }
}
