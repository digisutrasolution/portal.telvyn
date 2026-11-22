import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { requestContext } from "@/common/request-context";
import { ZodPipe } from "@/common/zod.pipe";
import { PaginationQuery, type PaginationInput } from "@/common/pagination";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { TenantGuard } from "@/authz/tenant.guard";
import { PlatformGuard } from "@/authz/platform.guard";
import { PermissionGuard } from "@/authz/permission.guard";
import { CurrentTenant, RequirePermissions } from "@/authz/authz.decorators";
import type { TenantContext } from "@/authz/tenant-context";
import { AuditService } from "@/authz/audit.service";
import { NodesService } from "./nodes.service";
import { NodeHealthService } from "./node-health.service";
import { NodeHealthEvaluatorService } from "./heartbeat/node-health-evaluator.service";
import { CreateNodeDto, UpdateNodeDto, type CreateNodeInput, type UpdateNodeInput } from "../infra.dto";

/** Platform telecom nodes. Config is durable; health is runtime (starts UNKNOWN). */
@Controller("v1/telecom/nodes")
@UseGuards(JwtAuthGuard, TenantGuard, PlatformGuard, PermissionGuard)
export class NodesController {
  constructor(
    private readonly nodes: NodesService,
    private readonly health: NodeHealthService,
    private readonly evaluator: NodeHealthEvaluatorService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Dead-man's-switch evaluator tick (ADR-0020 slice 3). A platform operator — or a
   * dedicated external cron with platform credentials — triggers this on the TTL
   * cadence. It compares every node's lastHeartbeatAt to the staleness TTL and
   * records honest HEALTHY/UNKNOWN transitions (caps at UNKNOWN). Multi-instance safe
   * (Redis-locked, fail-closed → skipped if held/unavailable). Transitions are the
   * durable record (append-only HealthEvent); an audit row is written ONLY when the
   * tick actually transitioned something (idle ticks are logged, not audited — a ~90s
   * cadence would otherwise firehose the audit table, ADR-0010).
   */
  @Post("health/evaluate")
  @HttpCode(200)
  @RequirePermissions("telecom.manage")
  async evaluate(@CurrentTenant() ctx: TenantContext, @Req() req: Request) {
    const summary = await this.evaluator.sweep();
    if (summary.transitioned > 0) {
      await this.audit.log({
        ctx,
        req: requestContext(req),
        action: "telecom.node.health_evaluated",
        resource: "node",
        metadata: { evaluated: summary.evaluated, transitioned: summary.transitioned, correlationId: summary.correlationId },
      });
    }
    return summary;
  }

  @Get()
  @RequirePermissions("telecom.read")
  list() {
    return this.nodes.list();
  }

  @Get(":id")
  @RequirePermissions("telecom.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.nodes.get(id);
  }

  @Get(":id/health")
  @RequirePermissions("telecom.health.read")
  getHealth(@Param("id", ParseUUIDPipe) id: string) {
    return this.nodes.getHealth(id);
  }

  /** Append-only node health-event history (newest first, cursor-paginated). Read-only. */
  @Get(":id/health-events")
  @RequirePermissions("telecom.health.read")
  async healthEvents(@Param("id", ParseUUIDPipe) id: string, @Query(new ZodPipe(PaginationQuery)) query: PaginationInput) {
    await this.nodes.get(id); // 404 if not found; platform-scoped
    return this.health.history(id, query);
  }

  /**
   * Operator-driven node health probe (foundation). Honest UNKNOWN — there is no
   * node liveness connector yet, so health is a posture from configuration; a NODE
   * HealthEvent is recorded on transition. No egress occurs. Audited.
   */
  @Post(":id/health-check")
  @HttpCode(200)
  @RequirePermissions("telecom.health.read")
  async healthCheck(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    const correlationId = randomUUID();
    const report = await this.health.probe(id, correlationId);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.node.health_checked",
      resource: "node",
      resourceId: id,
      metadata: { status: report.status, reachability: report.reachability, correlationId },
    });
    return report;
  }

  @Post()
  @RequirePermissions("telecom.manage")
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(CreateNodeDto)) body: CreateNodeInput,
    @Req() req: Request,
  ) {
    const node = await this.nodes.create(body);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.node.created", resource: "node", resourceId: node.id, metadata: { engineId: node.engineId } });
    return node;
  }

  @Put(":id")
  @RequirePermissions("telecom.manage")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateNodeDto)) body: UpdateNodeInput,
    @Req() req: Request,
  ) {
    const node = await this.nodes.update(id, body);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.node.updated", resource: "node", resourceId: id });
    return node;
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("telecom.manage")
  async remove(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.nodes.remove(id);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.node.deleted", resource: "node", resourceId: id });
  }
}
