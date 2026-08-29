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
import { SipTrunksService } from "./sip-trunks.service";
import {
  CreateSipTrunkDto,
  UpdateSipTrunkDto,
  ListSipTrunksQuery,
  type CreateSipTrunkInput,
  type UpdateSipTrunkInput,
  type ListSipTrunksInput,
} from "./sip-trunks.dto";

/**
 * SIP trunk API. JWT + tenant + permission gated; trunks are strictly
 * tenant-owned (auto-scoped in the service). Audit metadata records references
 * (carrierId, credentialId, transport, direction) — never secret material.
 */
@Controller("v1/telecom/sip-trunks")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class SipTrunksController {
  constructor(
    private readonly trunks: SipTrunksService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("sip_trunk.read")
  list(@CurrentTenant() ctx: TenantContext, @Query(new ZodPipe(ListSipTrunksQuery)) query: ListSipTrunksInput) {
    return this.trunks.list(ctx, query);
  }

  @Get(":id")
  @RequirePermissions("sip_trunk.read")
  get(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.trunks.get(ctx, id);
  }

  @Post()
  @RequirePermissions("sip_trunk.create")
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(CreateSipTrunkDto)) body: CreateSipTrunkInput,
    @Req() req: Request,
  ) {
    const trunk = await this.trunks.create(ctx, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.sip_trunk.created",
      resource: "sip_trunk",
      resourceId: trunk.id,
      metadata: {
        carrierId: trunk.carrierId,
        credentialId: trunk.credential?.id ?? null, // reference only
        transport: trunk.transport,
        direction: trunk.direction,
      },
    });
    return trunk;
  }

  @Patch(":id")
  @RequirePermissions("sip_trunk.update")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateSipTrunkDto)) body: UpdateSipTrunkInput,
    @Req() req: Request,
  ) {
    const trunk = await this.trunks.update(ctx, id, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.sip_trunk.updated",
      resource: "sip_trunk",
      resourceId: id,
      metadata: {
        carrierChanged: body.carrierId !== undefined,
        credentialChanged: body.credentialId !== undefined || body.credential !== undefined,
        credentialId: trunk.credential?.id ?? null, // reference only, never the secret
      },
    });
    return trunk;
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("sip_trunk.delete")
  async remove(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.trunks.remove(ctx, id);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.sip_trunk.deleted", resource: "sip_trunk", resourceId: id });
  }
}
