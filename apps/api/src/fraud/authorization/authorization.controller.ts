import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ZodPipe } from "@/common/zod.pipe";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { TenantGuard } from "@/authz/tenant.guard";
import { PermissionGuard } from "@/authz/permission.guard";
import { CurrentTenant, RequirePermissions } from "@/authz/authz.decorators";
import type { TenantContext } from "@/authz/tenant-context";
import { FraudAuthorizationService } from "./fraud-authorization.service";
import { CallAuthorizationService } from "./call-authorization.service";
import {
  PreviewAuthorizationDto,
  type PreviewAuthorizationInput,
  AuthorizeCallDto,
  type AuthorizeCallInputDto,
  CompleteCallDto,
  type CompleteCallInputDto,
  AbandonCallDto,
  type AbandonCallInputDto,
} from "./authorization.dto";

/**
 * Fraud authorization API (Phase 12R-4 + 12R-8, ADR-0021).
 *
 * `POST /preview` (12R-4) is a DRY-RUN of the decision for a hypothetical call —
 * read-only, no side effects, `fraud.policy.read`.
 *
 * `POST /authorize` (+ `/complete`, `/abandon`) (12R-8) is the ENFORCING hook the
 * live call path calls: it commits a reservation + counters on ALLOW and alerts
 * on DENY. Gated by `fraud.call.authorize` — a distinct, non-wildcard permission
 * held by the tenant's trusted call-origination identity (the real SBC/engine
 * identity is wired behind the delivery model, TELECOM #2). Scoped to the
 * caller's own tenant (tenantId is server-derived, never from the body).
 */
@Controller("v1/fraud/authorize")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class FraudAuthorizationController {
  constructor(
    private readonly authorization: FraudAuthorizationService,
    private readonly calls: CallAuthorizationService,
  ) {}

  @Post("preview")
  @HttpCode(200)
  @RequirePermissions("fraud.policy.read")
  preview(@CurrentTenant() ctx: TenantContext, @Body(new ZodPipe(PreviewAuthorizationDto)) body: PreviewAuthorizationInput) {
    return this.authorization.preview(ctx, { destinationRaw: body.destination, estimatedCostMicros: body.estimatedCostMicros });
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions("fraud.call.authorize")
  authorize(@CurrentTenant() ctx: TenantContext, @Body(new ZodPipe(AuthorizeCallDto)) body: AuthorizeCallInputDto) {
    return this.calls.authorizeCall(ctx, {
      callKey: body.callKey,
      destinationRaw: body.destination,
      estimatedCostMicros: body.estimatedCostMicros,
    });
  }

  @Post("complete")
  @HttpCode(204)
  @RequirePermissions("fraud.call.authorize")
  async complete(@CurrentTenant() ctx: TenantContext, @Body(new ZodPipe(CompleteCallDto)) body: CompleteCallInputDto): Promise<void> {
    await this.calls.completeCall(ctx, body.callKey, body.actualCostMicros);
  }

  @Post("abandon")
  @HttpCode(204)
  @RequirePermissions("fraud.call.authorize")
  async abandon(@CurrentTenant() ctx: TenantContext, @Body(new ZodPipe(AbandonCallDto)) body: AbandonCallInputDto): Promise<void> {
    await this.calls.abandonCall(ctx, body.callKey);
  }
}
