import {
  Body,
  ConflictException,
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
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { PaginationQuery, type PaginationInput } from "@/common/pagination";
import { randomUUID } from "node:crypto";
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
import { EngineConnectionManager } from "./runtime/engine-connection.manager";
import { EngineHealthService } from "./runtime/engine-health.service";
import { EngineSyncService, type SyncOutcome } from "./runtime/engine-sync.service";
import { EngineLockBusy, EngineLockUnavailable } from "./runtime/engine-lock.service";
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
    private readonly connection: EngineConnectionManager,
    private readonly health: EngineHealthService,
    private readonly syncSvc: EngineSyncService,
    private readonly audit: AuditService,
  ) {}

  // ---- engine abstraction (Phase 12K) + runtime foundation (Phase 12L) ----

  /**
   * Normalized engine status: explicit capabilities + honest health (UNKNOWN for
   * stubs) + runtime posture — connection reachability (SSRF-guarded, no live
   * egress in the foundation) and configuration version (desired/applied).
   */
  @Get(":id/status")
  @RequirePermissions("telecom.health.read")
  async status(@Param("id", ParseUUIDPipe) id: string) {
    const engine = await this.engines.get(id); // 404 if not found; platform-scoped
    const correlationId = randomUUID();
    const base = await this.engineSvc.getStatus({ id, type: engine.type });
    const connection = await this.connection.resolve({ provider: engine.type, endpoint: engine.endpoint, credentialId: engine.credentialId, status: engine.status, correlationId });
    const version = await this.syncSvc.posture(id);
    const desired = await this.syncSvc.previewDesired({ id, type: engine.type, endpoint: engine.endpoint, status: engine.status });
    return {
      ...base,
      connection: { state: connection.state, endpointConfigured: connection.endpointConfigured, detail: connection.detail },
      version, // { desiredVersion, appliedVersion, versions } — applied stays null until a real engine applies
      desired, // live desired config from current resource assignments: { version, summary{carriers,trunks,dids,routes} }
    };
  }

  /** Actively probe engine health (SSRF-guarded). Honest UNKNOWN with the NullConnector; records a HealthEvent on transition. */
  @Post(":id/health-check")
  @RequirePermissions("telecom.health.read")
  async healthCheck(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    const engine = await this.engines.get(id);
    const correlationId = randomUUID();
    const report = await this.health.probe({ id, type: engine.type, endpoint: engine.endpoint, credentialId: engine.credentialId, status: engine.status }, correlationId);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.engine.health_checked",
      resource: "engine",
      resourceId: id,
      metadata: { status: report.status, reachability: report.reachability, correlationId, provider: engine.type },
    });
    return report;
  }

  /** Append-only health-event history for the engine (newest first, cursor-paginated). Read-only. */
  @Get(":id/health-events")
  @RequirePermissions("telecom.health.read")
  async healthEvents(@Param("id", ParseUUIDPipe) id: string, @Query(new ZodPipe(PaginationQuery)) query: PaginationInput) {
    await this.engines.get(id); // 404 if not found; platform-scoped
    return this.health.history(id, query);
  }

  /** Append-only config-version history for the engine (newest first, cursor-paginated). Read-only; secret-free snapshots. */
  @Get(":id/config-versions")
  @RequirePermissions("telecom.health.read")
  async configVersions(@Param("id", ParseUUIDPipe) id: string, @Query(new ZodPipe(PaginationQuery)) query: PaginationInput) {
    await this.engines.get(id); // 404 if not found; platform-scoped
    return this.syncSvc.history(id, query);
  }

  /**
   * Attempt versioned, idempotent, concurrency-guarded synchronization of
   * control-plane config to the engine. With stub adapters this returns a
   * normalized NOT_IMPLEMENTED → HTTP 501 (no fake success, no live connectivity).
   * A concurrent sync is refused (409); a lock outage fails closed (503). Always audited.
   */
  @Post(":id/sync")
  @RequirePermissions("telecom.manage")
  async sync(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    const engine = await this.engines.get(id);
    const ref = { id, type: engine.type, endpoint: engine.endpoint, credentialId: engine.credentialId, status: engine.status };
    const result = await this.run(() => this.syncSvc.sync(ref, ctx.userId, randomUUID()));
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.engine.sync_attempted",
      resource: "engine",
      resourceId: id,
      metadata: { outcome: result.outcome, code: result.code, syncState: result.syncState, correlationId: result.correlationId, provider: engine.type, desiredVersion: result.desiredVersion, appliedVersion: result.appliedVersion },
    });
    return this.mapOutcome(result);
  }

  /** Roll back to the previous desired configuration version (append-only; honest apply). */
  @Post(":id/sync/rollback")
  @RequirePermissions("telecom.manage")
  async rollback(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    const engine = await this.engines.get(id);
    const ref = { id, type: engine.type, endpoint: engine.endpoint, credentialId: engine.credentialId, status: engine.status };
    const result = await this.run(() => this.syncSvc.rollback(ref, ctx.userId, randomUUID()));
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.engine.rollback_attempted",
      resource: "engine",
      resourceId: id,
      metadata: { outcome: result.outcome, code: result.code, correlationId: result.correlationId, provider: engine.type, desiredVersion: result.desiredVersion },
    });
    return this.mapOutcome(result);
  }

  /** Translate lock failures into HTTP; other errors (e.g. 400 no-previous-version) propagate. */
  private async run(op: () => Promise<SyncOutcome>): Promise<SyncOutcome> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof EngineLockBusy) throw new ConflictException("engine sync already in progress");
      if (e instanceof EngineLockUnavailable) throw new ServiceUnavailableException("engine sync lock unavailable");
      throw e;
    }
  }

  /** Honest HTTP mapping: NOT_IMPLEMENTED→501, TIMEOUT→504, other failure→503; success returns the outcome. */
  private mapOutcome(result: SyncOutcome): SyncOutcome {
    if (!result.ok) {
      const msg = `engine ${result.outcome.toLowerCase()}`;
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
