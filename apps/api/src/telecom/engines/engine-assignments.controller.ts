import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
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
import { EngineAssignmentsService } from "./engine-assignments.service";
import {
  AssignEngineResourceDto,
  UpdateEngineAssignmentDto,
  type AssignEngineResourceInput,
  type UpdateEngineAssignmentInput,
} from "../infra.dto";

/**
 * Platform management of engine ↔ resource assignments (Phase 12N-2). Deciding
 * which tenant/platform resources deploy to a shared engine is a PLATFORM
 * operation — never tenant self-service. Every mutation is audited; `tenantId`
 * is derived from the resource, never from the caller.
 */
@Controller("v1/telecom/engines/:engineId/assignments")
@UseGuards(JwtAuthGuard, TenantGuard, PlatformGuard, PermissionGuard)
export class EngineAssignmentsController {
  constructor(
    private readonly assignments: EngineAssignmentsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("telecom.read")
  list(@Param("engineId", ParseUUIDPipe) engineId: string) {
    return this.assignments.list(engineId);
  }

  @Post()
  @RequirePermissions("telecom.manage")
  async assign(
    @CurrentTenant() ctx: TenantContext,
    @Param("engineId", ParseUUIDPipe) engineId: string,
    @Body(new ZodPipe(AssignEngineResourceDto)) body: AssignEngineResourceInput,
    @Req() req: Request,
  ) {
    const assignment = await this.assignments.assign(engineId, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.engine.resource_assigned",
      resource: "engine",
      resourceId: engineId,
      metadata: { assignmentId: assignment.id, kind: assignment.kind, resourceId: assignment.resource.id, enabled: assignment.enabled },
    });
    return assignment;
  }

  @Patch(":assignmentId")
  @RequirePermissions("telecom.manage")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("engineId", ParseUUIDPipe) engineId: string,
    @Param("assignmentId", ParseUUIDPipe) assignmentId: string,
    @Body(new ZodPipe(UpdateEngineAssignmentDto)) body: UpdateEngineAssignmentInput,
    @Req() req: Request,
  ) {
    const assignment = await this.assignments.setEnabled(engineId, assignmentId, body.enabled);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.engine.resource_assignment_updated",
      resource: "engine",
      resourceId: engineId,
      metadata: { assignmentId, enabled: assignment.enabled },
    });
    return assignment;
  }

  @Delete(":assignmentId")
  @HttpCode(204)
  @RequirePermissions("telecom.manage")
  async unassign(
    @CurrentTenant() ctx: TenantContext,
    @Param("engineId", ParseUUIDPipe) engineId: string,
    @Param("assignmentId", ParseUUIDPipe) assignmentId: string,
    @Req() req: Request,
  ) {
    await this.assignments.unassign(engineId, assignmentId);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.engine.resource_unassigned",
      resource: "engine",
      resourceId: engineId,
      metadata: { assignmentId },
    });
  }
}
