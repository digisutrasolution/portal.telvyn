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
import { DidsService } from "./dids.service";
import { CreateDidDto, UpdateDidDto, ListDidsQuery, type CreateDidInput, type UpdateDidInput, type ListDidsInput } from "./dids.dto";

/**
 * DID API. JWT + tenant + permission gated; strictly tenant-owned (auto-scoped).
 * Audit metadata carries safe references only (didId/carrierId/sipTrunkId/
 * routingProfileId/regionId/status) — never secrets or embedded objects.
 */
@Controller("v1/telecom/dids")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class DidsController {
  constructor(
    private readonly dids: DidsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("did.read")
  list(@CurrentTenant() ctx: TenantContext, @Query(new ZodPipe(ListDidsQuery)) query: ListDidsInput) {
    return this.dids.list(ctx, query);
  }

  @Get(":id")
  @RequirePermissions("did.read")
  get(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.dids.get(ctx, id);
  }

  @Post()
  @RequirePermissions("did.manage")
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(CreateDidDto)) body: CreateDidInput,
    @Req() req: Request,
  ) {
    const did = await this.dids.create(ctx, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.did.created",
      resource: "did",
      resourceId: did.id,
      metadata: { e164: did.e164, carrierId: did.carrierId, sipTrunkId: did.sipTrunkId, routingProfileId: did.routingProfileId, regionId: did.regionId, status: did.status },
    });
    return did;
  }

  @Patch(":id")
  @RequirePermissions("did.manage")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateDidDto)) body: UpdateDidInput,
    @Req() req: Request,
  ) {
    const did = await this.dids.update(ctx, id, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.did.updated",
      resource: "did",
      resourceId: id,
      metadata: { carrierId: did.carrierId, sipTrunkId: did.sipTrunkId, routingProfileId: did.routingProfileId, regionId: did.regionId, status: did.status },
    });
    return did;
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("did.manage")
  async remove(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.dids.remove(ctx, id);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.did.deleted", resource: "did", resourceId: id });
  }
}
