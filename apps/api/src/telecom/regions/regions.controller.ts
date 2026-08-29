import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { requestContext } from "@/common/request-context";
import { ZodPipe } from "@/common/zod.pipe";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { TenantGuard } from "@/authz/tenant.guard";
import { PlatformGuard } from "@/authz/platform.guard";
import { PermissionGuard } from "@/authz/permission.guard";
import { CurrentTenant, RequirePermissions } from "@/authz/authz.decorators";
import type { TenantContext } from "@/authz/tenant-context";
import { AuditService } from "@/authz/audit.service";
import { RegionsService } from "./regions.service";
import { CreateRegionDto, UpdateRegionDto, type CreateRegionInput, type UpdateRegionInput } from "../infra.dto";

/** Platform regions. Every route is JWT + tenant + PLATFORM-scope + permission gated. */
@Controller("v1/telecom/regions")
@UseGuards(JwtAuthGuard, TenantGuard, PlatformGuard, PermissionGuard)
export class RegionsController {
  constructor(
    private readonly regions: RegionsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("telecom.read")
  list() {
    return this.regions.list();
  }

  @Get(":id")
  @RequirePermissions("telecom.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.regions.get(id);
  }

  @Post()
  @RequirePermissions("telecom.manage")
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(CreateRegionDto)) body: CreateRegionInput,
    @Req() req: Request,
  ) {
    const region = await this.regions.create(body);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.region.created", resource: "region", resourceId: region.id, metadata: { code: region.code } });
    return region;
  }

  @Put(":id")
  @RequirePermissions("telecom.manage")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateRegionDto)) body: UpdateRegionInput,
    @Req() req: Request,
  ) {
    const region = await this.regions.update(id, body);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.region.updated", resource: "region", resourceId: id });
    return region;
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("telecom.manage")
  async remove(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.regions.remove(id);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.region.deleted", resource: "region", resourceId: id });
  }
}
