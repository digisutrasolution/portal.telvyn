import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ZodPipe } from "@/common/zod.pipe";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { TenantGuard } from "@/authz/tenant.guard";
import { PermissionGuard } from "@/authz/permission.guard";
import { CurrentTenant, RequirePermissions } from "@/authz/authz.decorators";
import type { TenantContext } from "@/authz/tenant-context";
import { FraudAuthorizationService } from "./fraud-authorization.service";
import { PreviewAuthorizationDto, type PreviewAuthorizationInput } from "./authorization.dto";

/**
 * Fraud authorization API (Phase 12R-4, ADR-0021). Exposes a DRY-RUN preview of
 * the toll-fraud decision for a hypothetical call, so operators can test their
 * policies + kill-switch against a destination. It is read-only and does NOT
 * enforce anything — no call is placed, no reservation is taken, no engine is
 * contacted. Requires `fraud.policy.read` (it reads the tenant's own policies).
 */
@Controller("v1/fraud/authorize")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class FraudAuthorizationController {
  constructor(private readonly authorization: FraudAuthorizationService) {}

  @Post("preview")
  @HttpCode(200)
  @RequirePermissions("fraud.policy.read")
  preview(@CurrentTenant() ctx: TenantContext, @Body(new ZodPipe(PreviewAuthorizationDto)) body: PreviewAuthorizationInput) {
    return this.authorization.preview(ctx, { destinationRaw: body.destination, estimatedCostMicros: body.estimatedCostMicros });
  }
}
