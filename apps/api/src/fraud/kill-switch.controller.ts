import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { requestContext } from "@/common/request-context";
import { ZodPipe } from "@/common/zod.pipe";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { TenantGuard } from "@/authz/tenant.guard";
import { PlatformGuard } from "@/authz/platform.guard";
import { PermissionGuard } from "@/authz/permission.guard";
import { CurrentTenant, RequirePermissions } from "@/authz/authz.decorators";
import type { TenantContext } from "@/authz/tenant-context";
import { KillSwitchService } from "./kill-switch.service";
import { ToggleKillSwitchDto, type ToggleKillSwitchInput } from "./kill-switch.dto";

/**
 * Tenant kill-switch API (Phase 12R-3, ADR-0021). A tenant's emergency brake on
 * its own calling — STATE only, nothing is enforced yet. Read the current state
 * with `fraud.policy.read`; activate/deactivate with `fraud.killswitch`. The
 * tenant scope is server-derived; every toggle is audited + emits a KILL_SWITCH
 * FraudEvent.
 */
@Controller("v1/fraud/kill-switch")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class KillSwitchController {
  constructor(private readonly ks: KillSwitchService) {}

  @Get()
  @RequirePermissions("fraud.policy.read")
  get(@CurrentTenant() ctx: TenantContext) {
    return this.ks.getTenant(ctx);
  }

  @Post("activate")
  @HttpCode(200)
  @RequirePermissions("fraud.killswitch.manage")
  activate(@CurrentTenant() ctx: TenantContext, @Body(new ZodPipe(ToggleKillSwitchDto)) body: ToggleKillSwitchInput, @Req() req: Request) {
    return this.ks.setTenant(ctx, requestContext(req), true, body.reason);
  }

  @Post("deactivate")
  @HttpCode(200)
  @RequirePermissions("fraud.killswitch.manage")
  deactivate(@CurrentTenant() ctx: TenantContext, @Body(new ZodPipe(ToggleKillSwitchDto)) body: ToggleKillSwitchInput, @Req() req: Request) {
    return this.ks.setTenant(ctx, requestContext(req), false, body.reason);
  }
}

/**
 * Global kill-switch API (Phase 12R-3, ADR-0021). The platform-wide emergency
 * brake — STATE only, nothing is enforced yet. PLATFORM tenant only
 * (PlatformGuard). Read with `fraud.policy.read`; toggle with `fraud.killswitch`.
 */
@Controller("v1/fraud/kill-switch/global")
@UseGuards(JwtAuthGuard, TenantGuard, PlatformGuard, PermissionGuard)
export class GlobalKillSwitchController {
  constructor(private readonly ks: KillSwitchService) {}

  @Get()
  @RequirePermissions("fraud.policy.read")
  get() {
    return this.ks.getGlobal();
  }

  @Post("activate")
  @HttpCode(200)
  @RequirePermissions("fraud.killswitch.manage")
  activate(@CurrentTenant() ctx: TenantContext, @Body(new ZodPipe(ToggleKillSwitchDto)) body: ToggleKillSwitchInput, @Req() req: Request) {
    return this.ks.setGlobal(ctx, requestContext(req), true, body.reason);
  }

  @Post("deactivate")
  @HttpCode(200)
  @RequirePermissions("fraud.killswitch.manage")
  deactivate(@CurrentTenant() ctx: TenantContext, @Body(new ZodPipe(ToggleKillSwitchDto)) body: ToggleKillSwitchInput, @Req() req: Request) {
    return this.ks.setGlobal(ctx, requestContext(req), false, body.reason);
  }
}
