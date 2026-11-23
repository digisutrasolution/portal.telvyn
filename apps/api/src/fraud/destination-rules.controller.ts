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
import { DestinationRulesService } from "./destination-rules.service";
import {
  CreateDestinationRuleDto,
  UpdateDestinationRuleDto,
  ListDestinationRulesQuery,
  type CreateDestinationRuleInput,
  type UpdateDestinationRuleInput,
  type ListDestinationRulesInput,
} from "./destination-rules.dto";

/**
 * Geo/destination-rule API (Phase 12R-2c, ADR-0021). Tenant-authored
 * fraud-policy config — DECLARATIVE only (nothing enforces these yet). JWT +
 * tenant + permission gated; isolation is enforced by the tenant-scoping client.
 * Reads need `fraud.policy.read`; writes need `fraud.policy.manage`, and every
 * mutation is audited.
 */
@Controller("v1/fraud/policies/destination-rules")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class DestinationRulesController {
  constructor(
    private readonly rules: DestinationRulesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("fraud.policy.read")
  list(@CurrentTenant() ctx: TenantContext, @Query(new ZodPipe(ListDestinationRulesQuery)) query: ListDestinationRulesInput) {
    return this.rules.list(ctx, query);
  }

  @Get(":id")
  @RequirePermissions("fraud.policy.read")
  get(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.rules.get(ctx, id);
  }

  @Post()
  @RequirePermissions("fraud.policy.manage")
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(CreateDestinationRuleDto)) body: CreateDestinationRuleInput,
    @Req() req: Request,
  ) {
    const rule = await this.rules.create(ctx, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "fraud.destination_rule.created",
      resource: "destination_rule",
      resourceId: rule.id,
      metadata: { matchType: rule.matchType, matchValue: rule.matchValue, action: rule.action, riskClass: rule.riskClass, enabled: rule.enabled },
    });
    return rule;
  }

  @Patch(":id")
  @RequirePermissions("fraud.policy.manage")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateDestinationRuleDto)) body: UpdateDestinationRuleInput,
    @Req() req: Request,
  ) {
    const rule = await this.rules.update(ctx, id, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "fraud.destination_rule.updated",
      resource: "destination_rule",
      resourceId: id,
      metadata: { action: rule.action, riskClass: rule.riskClass, enabled: rule.enabled },
    });
    return rule;
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("fraud.policy.manage")
  async remove(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.rules.remove(ctx, id);
    await this.audit.log({ ctx, req: requestContext(req), action: "fraud.destination_rule.deleted", resource: "destination_rule", resourceId: id });
  }
}
