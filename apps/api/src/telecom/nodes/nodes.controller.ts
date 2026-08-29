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
import { NodesService } from "./nodes.service";
import { CreateNodeDto, UpdateNodeDto, type CreateNodeInput, type UpdateNodeInput } from "../infra.dto";

/** Platform telecom nodes. Config is durable; health is runtime (starts UNKNOWN). */
@Controller("v1/telecom/nodes")
@UseGuards(JwtAuthGuard, TenantGuard, PlatformGuard, PermissionGuard)
export class NodesController {
  constructor(
    private readonly nodes: NodesService,
    private readonly audit: AuditService,
  ) {}

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
