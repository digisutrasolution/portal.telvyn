import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotImplementedException,
  ServiceUnavailableException,
  GatewayTimeoutException,
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
import { TenantGuard } from "@/authz/tenant.guard";
import { PlatformGuard } from "@/authz/platform.guard";
import { PermissionGuard } from "@/authz/permission.guard";
import { CurrentTenant, RequirePermissions } from "@/authz/authz.decorators";
import type { TenantContext } from "@/authz/tenant-context";
import { AuditService } from "@/authz/audit.service";
import { EnginesService } from "./engines.service";
import { EngineService } from "./engine.service";
import { EngineErrorCode } from "./engine.types";
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
    private readonly engineSvc: EngineService,
    private readonly audit: AuditService,
  ) {}

  // ---- engine abstraction (Phase 12K) ----

  /** Normalized engine status: explicit capabilities + honest health (UNKNOWN for stubs). */
  @Get(":id/status")
  @RequirePermissions("telecom.health.read")
  async status(@Param("id", ParseUUIDPipe) id: string) {
    const engine = await this.engines.get(id); // 404 if not found; platform-scoped
    return this.engineSvc.getStatus({ id, type: engine.type });
  }

  /**
   * Attempt to synchronize control-plane config to the engine. With stub
   * adapters this returns a normalized NOT_IMPLEMENTED → HTTP 501 (no fake
   * success, no engine connectivity). The attempt is audited regardless.
   */
  @Post(":id/sync")
  @RequirePermissions("telecom.manage")
  async sync(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    const engine = await this.engines.get(id);
    // Empty desired-state intent for now — engine↔resource assignment is future.
    const intent = this.engineSvc.buildConfigurationIntent({ engineType: engine.type, carriers: [], trunks: [], dids: [], routes: [] });
    const result = await this.engineSvc.sync({ id, type: engine.type }, intent);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.engine.sync_attempted",
      resource: "engine",
      resourceId: id,
      metadata: { outcome: result.outcome, code: result.code, correlationId: result.correlationId, provider: engine.type },
    });
    if (!result.ok) {
      const msg = `engine sync ${result.outcome.toLowerCase()}`;
      if (result.code === EngineErrorCode.NOT_IMPLEMENTED) throw new NotImplementedException(msg);
      if (result.code === EngineErrorCode.TIMEOUT) throw new GatewayTimeoutException(msg);
      throw new ServiceUnavailableException(msg);
    }
    return result;
  }

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
