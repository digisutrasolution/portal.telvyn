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
import { CarriersService } from "./carriers.service";
import {
  CreateCarrierDto,
  UpdateCarrierDto,
  ListCarriersQuery,
  type CreateCarrierInput,
  type UpdateCarrierInput,
  type ListCarriersInput,
} from "./carriers.dto";

/**
 * Carrier API. JWT + tenant + permission gated; system-vs-tenant scope is
 * enforced inside the service (ADR-0008), not by a client-supplied field.
 * Audit metadata records only a credentialId reference — never secret material.
 */
@Controller("v1/telecom/carriers")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class CarriersController {
  constructor(
    private readonly carriers: CarriersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions("carrier.read")
  list(@CurrentTenant() ctx: TenantContext, @Query(new ZodPipe(ListCarriersQuery)) query: ListCarriersInput) {
    return this.carriers.list(ctx, query);
  }

  @Get(":id")
  @RequirePermissions("carrier.read")
  get(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.carriers.get(ctx, id);
  }

  @Post()
  @RequirePermissions("carrier.create")
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(CreateCarrierDto)) body: CreateCarrierInput,
    @Req() req: Request,
  ) {
    const carrier = await this.carriers.create(ctx, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.carrier.created",
      resource: "carrier",
      resourceId: carrier.id,
      metadata: { scope: carrier.scope, credentialId: carrier.credential?.id ?? null }, // no secret
    });
    return carrier;
  }

  @Patch(":id")
  @RequirePermissions("carrier.update")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateCarrierDto)) body: UpdateCarrierInput,
    @Req() req: Request,
  ) {
    const carrier = await this.carriers.update(ctx, id, body);
    await this.audit.log({
      ctx,
      req: requestContext(req),
      action: "telecom.carrier.updated",
      resource: "carrier",
      resourceId: id,
      metadata: {
        credentialChanged: body.credentialId !== undefined || body.credential !== undefined,
        credentialId: carrier.credential?.id ?? null, // reference only, never the secret
      },
    });
    return carrier;
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions("carrier.delete")
  async remove(@CurrentTenant() ctx: TenantContext, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.carriers.remove(ctx, id);
    await this.audit.log({ ctx, req: requestContext(req), action: "telecom.carrier.deleted", resource: "carrier", resourceId: id });
  }
}
