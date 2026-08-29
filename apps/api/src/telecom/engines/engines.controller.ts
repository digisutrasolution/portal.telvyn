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
import { EnginesService } from "./engines.service";
import {
  CreateEngineDto,
  UpdateEngineDto,
  SetEngineCapabilitiesDto,
  type CreateEngineInput,
  type UpdateEngineInput,
  type SetEngineCapabilitiesInput,
} from "../infra.dto";

/** Platform telecom engines + capability configuration. */
@Controller("v1/telecom/engines")
@UseGuards(JwtAuthGuard, TenantGuard, PlatformGuard, PermissionGuard)
export class EnginesController {
  constructor(
    private readonly engines: EnginesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("telecom.read")
  list() {
    return this.engines.list();
  }

  @Get(":id")
  @RequirePermissions("telecom.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.engines.get(id);
  }

  @Post()
  @RequirePermissions("telecom.manage")
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(CreateEngineDto)) body: CreateEngineInput,
    @Req() req: Request,
  ) {
    const engine = await this.engines.create(body);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.engine.created", resource: "engine", resourceId: engine.id, metadata: { type: engine.type } });
    return engine;
  }

  @Put(":id")
  @RequirePermissions("telecom.manage")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateEngineDto)) body: UpdateEngineInput,
    @Req() req: Request,
  ) {
    const engine = await this.engines.update(id, body);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.engine.updated", resource: "engine", resourceId: id });
    return engine;
  }

  @Put(":id/capabilities")
  @RequirePermissions("telecom.manage")
  async setCapabilities(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(SetEngineCapabilitiesDto)) body: SetEngineCapabilitiesInput,
    @Req() req: Request,
  ) {
    const engine = await this.engines.setCapabilities(id, body);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.engine.capabilities_set", resource: "engine", resourceId: id, metadata: { capabilities: [...new Set(body.capabilities)] } });
    return engine;
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("telecom.manage")
  async remove(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.engines.remove(id);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.engine.deleted", resource: "engine", resourceId: id });
  }
}
