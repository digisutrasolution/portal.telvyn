import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { requestContext } from "@/common/request-context";
import { ZodPipe } from "@/common/zod.pipe";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { TenantGuard } from "@/authz/tenant.guard";
import { PermissionGuard } from "@/authz/permission.guard";
import { CurrentTenant, RequirePermissions } from "@/authz/authz.decorators";
import type { TenantContext } from "@/authz/tenant-context";
import { AuditService } from "@/authz/audit.service";
import { LcrService } from "./lcr.service";
import {
  CreateLcrPolicyDto,
  UpdateLcrPolicyDto,
  ListLcrPoliciesQuery,
  type CreateLcrPolicyInput,
  type UpdateLcrPolicyInput,
  type ListLcrPoliciesInput,
} from "./lcr.dto";

/**
 * LCR policy API. JWT + tenant + permission gated; strictly tenant-owned
 * (auto-scoped). Reuses routing.read / routing.manage (LCR is part of the
 * routing domain — no separate credential access). Declarative config only —
 * no runtime execution, no rating, no billing. Audit records safe metadata only.
 */
@Controller("v1/telecom/lcr-policies")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class LcrController {
  constructor(
    private readonly lcr: LcrService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("routing.read")
  list(@CurrentTenant() ctx: TenantContext, @Query(new ZodPipe(ListLcrPoliciesQuery)) query: ListLcrPoliciesInput) {
    return this.lcr.list(ctx, query);
  }

  @Get(":id")
  @RequirePermissions("routing.read")
  get(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.lcr.get(ctx, id);
  }

  @Post()
  @RequirePermissions("routing.manage")
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(CreateLcrPolicyDto)) body: CreateLcrPolicyInput,
    @Req() req: Request,
  ) {
    const policy = await this.lcr.create(ctx, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.lcr_policy.created",
      resource: "lcr_policy",
      resourceId: policy.id,
      metadata: { strategy: policy.selectionStrategy, enabled: policy.enabled, routeCount: policy.candidates.length, version: policy.version },
    });
    return policy;
  }

  @Patch(":id")
  @RequirePermissions("routing.manage")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateLcrPolicyDto)) body: UpdateLcrPolicyInput,
    @Req() req: Request,
  ) {
    const policy = await this.lcr.update(ctx, id, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.lcr_policy.updated",
      resource: "lcr_policy",
      resourceId: id,
      metadata: { strategy: policy.selectionStrategy, enabled: policy.enabled, routeCount: policy.candidates.length, routesReplaced: body.routes !== undefined, version: policy.version },
    });
    return policy;
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("routing.manage")
  async remove(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.lcr.remove(ctx, id);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.lcr_policy.deleted", resource: "lcr_policy", resourceId: id });
  }
}
