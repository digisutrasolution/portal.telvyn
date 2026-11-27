import { Body, Controller, Headers, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { requestContext } from "@/common/request-context";
import { ZodPipe } from "@/common/zod.pipe";
import { Auth, JwtAuthGuard } from "@/auth/jwt-auth.guard";
import type { AccessClaims } from "@/auth/token.service";
import { TenantGuard } from "@/authz/tenant.guard";
import { CurrentTenant } from "@/authz/authz.decorators";
import type { TenantContext } from "@/authz/tenant-context";
import { BillingAccountProvisioningService } from "./billing-account-provisioning.service";
import { ProvisionBillingAccountDto, type ProvisionBillingAccountInput } from "./billing-account-provisioning.contract";

const CORRELATION_ID = /^[A-Za-z0-9\-_.:]{1,128}$/;

/**
 * Platform billing-account provisioning API (Phase 13-2B S5).
 *
 * Authorization is deny-by-default and enforced INSIDE
 * BillingAccountProvisioningService (platform tenant + explicit, MFA-effective
 * `billing.account.provision` + a fresh single-use step-up grant) and again by
 * the database function billing.billing_account_provision — not by the generic
 * PermissionGuard/PlatformGuard — so that every refused attempt by an
 * authenticated member is recorded as a DENIED financial audit event (BA-14).
 * Unauthenticated requests and members without an active tenant are refused by
 * JwtAuthGuard / TenantGuard before reaching it.
 *
 * Responses: 201 a new account; 200 a replay of an earlier completed request with
 * the same Idempotency-Key and identical parameters.
 */
@Controller("v1/platform/billing-accounts")
@UseGuards(JwtAuthGuard, TenantGuard)
export class BillingAccountController {
  constructor(private readonly provisioning: BillingAccountProvisioningService) {}

  @Post()
  async provision(
    @Auth() auth: AccessClaims,
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(ProvisionBillingAccountDto)) body: ProvisionBillingAccountInput,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const account = await this.provisioning.provision(
      {
        ctx,
        sessionId: auth.sid,
        req: requestContext(req),
        correlationId: correlationId && CORRELATION_ID.test(correlationId) ? correlationId : null,
      },
      body,
      idempotencyKey,
    );
    res.status(account.replayed ? 200 : 201);
    return account;
  }
}
