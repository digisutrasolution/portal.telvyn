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
import { RoutingProfilesService } from "./routing.service";
import {
  CreateRoutingProfileDto,
  UpdateRoutingProfileDto,
  ListRoutingProfilesQuery,
  type CreateRoutingProfileInput,
  type UpdateRoutingProfileInput,
  type ListRoutingProfilesInput,
} from "./routing.dto";

/**
 * Routing profile API. JWT + tenant + permission gated; strictly tenant-owned
 * (auto-scoped). Declarative config only — no runtime execution. Audit metadata
 * records counts/status only (never webhook payloads or secrets).
 */
@Controller("v1/telecom/routing-profiles")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class RoutingProfilesController {
  constructor(
    private readonly profiles: RoutingProfilesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("routing.read")
  list(@CurrentTenant() ctx: TenantContext, @Query(new ZodPipe(ListRoutingProfilesQuery)) query: ListRoutingProfilesInput) {
    return this.profiles.list(ctx, query);
  }

  @Get(":id")
  @RequirePermissions("routing.read")
  get(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.profiles.get(ctx, id);
  }

  @Post()
  @RequirePermissions("routing.manage")
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(CreateRoutingProfileDto)) body: CreateRoutingProfileInput,
    @Req() req: Request,
  ) {
    const profile = await this.profiles.create(ctx, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.routing_profile.created",
      resource: "routing_profile",
      resourceId: profile.id,
      metadata: { direction: profile.direction, status: profile.status, ruleCount: profile.rules.length },
    });
    return profile;
  }

  @Patch(":id")
  @RequirePermissions("routing.manage")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateRoutingProfileDto)) body: UpdateRoutingProfileInput,
    @Req() req: Request,
  ) {
    const profile = await this.profiles.update(ctx, id, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.routing_profile.updated",
      resource: "routing_profile",
      resourceId: id,
      metadata: { status: profile.status, ruleCount: profile.rules.length, rulesReplaced: body.rules !== undefined },
    });
    return profile;
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("routing.manage")
  async remove(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.profiles.remove(ctx, id);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.routing_profile.deleted", resource: "routing_profile", resourceId: id });
  }
}
