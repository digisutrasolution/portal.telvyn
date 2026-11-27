import { Body, Controller, ForbiddenException, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { requestContext } from "@/common/request-context";
import { ZodPipe } from "@/common/zod.pipe";
import { TenantGuard } from "@/authz/tenant.guard";
import { CurrentTenant } from "@/authz/authz.decorators";
import type { TenantContext } from "@/authz/tenant-context";
import { Auth, JwtAuthGuard } from "./jwt-auth.guard";
import type { AccessClaims } from "./token.service";
import { RateLimitService, RATE_RULES } from "./rate-limit.service";
import { SecurityEventsService } from "./security-events.service";
import { STEP_UP_PURPOSES, StepUpError, StepUpService } from "./step-up.service";
import { StepUpIssueDto, type StepUpIssueInput } from "./dto";

/**
 * Financial step-up issuance (ADR-0022 Amendment 5 BA-15; Phase 13-2B S5, owner
 * decision O1). The caller proves a FRESH TOTP code (recovery codes are never
 * accepted here; the TOTP replay guard applies) and receives a single-use grant
 * bound to its user, session, active tenant and one server-defined purpose,
 * valid for 300 s. The grant is consumed atomically inside the protected
 * operation's own transaction. Identity, session and tenant come from the
 * authenticated token and the server-built TenantContext — never the body.
 *
 * Every failure is the same generic 403 (no detail on which check failed).
 * Issuance and failures are recorded as security telemetry (SecurityEvent,
 * with request IP/user agent) — not as financial audit (O6).
 */
@Controller("v1/auth/step-up")
@UseGuards(JwtAuthGuard, TenantGuard)
export class StepUpController {
  constructor(
    private readonly stepUp: StepUpService,
    private readonly rate: RateLimitService,
    private readonly events: SecurityEventsService,
  ) {}

  @Post()
  @HttpCode(201)
  async issue(
    @Auth() auth: AccessClaims,
    @CurrentTenant() ctx: TenantContext,
    @Body(new ZodPipe(StepUpIssueDto)) body: StepUpIssueInput,
    @Req() req: Request,
  ) {
    const rc = requestContext(req);
    await this.rate.consume(RATE_RULES.stepUp, auth.sub);
    try {
      if (!STEP_UP_PURPOSES.has(body.purpose)) throw new StepUpError("invalid_purpose");
      const grant = await this.stepUp.issue(
        { userId: auth.sub, sessionId: auth.sid, tenantId: ctx.tenantId, purpose: body.purpose },
        body.code,
      );
      await this.events.record("step_up.issued", rc, auth.sub, { purpose: body.purpose, grantId: grant.grantId });
      return { grantId: grant.grantId, purpose: body.purpose, expiresAt: grant.expiresAt.toISOString() };
    } catch (e) {
      if (e instanceof StepUpError) {
        await this.events.record("step_up.failed", rc, auth.sub, { purpose: body.purpose, reason: e.reason });
        throw new ForbiddenException("Step-up verification failed");
      }
      throw e;
    }
  }
}
