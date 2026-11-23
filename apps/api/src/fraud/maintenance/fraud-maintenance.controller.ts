import { Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { TenantGuard } from "@/authz/tenant.guard";
import { PlatformGuard } from "@/authz/platform.guard";
import { PermissionGuard } from "@/authz/permission.guard";
import { RequirePermissions } from "@/authz/authz.decorators";
import { FraudSweeperService } from "./fraud-sweeper.service";

/**
 * Fraud maintenance API (Phase 12R-9, ADR-0021) — the SYSTEM, cross-tenant sweep
 * that reconciles resources leaked by calls authorized but never finalized
 * (expired reservations + their concurrent-gauge holds). PLATFORM-only
 * (PlatformGuard) + `fraud.maintenance.run`: an external scheduler (ops cron /
 * k8s CronJob) with a platform identity invokes it on a cadence — the service
 * owns no in-process timer (it would fan out across instances). See the
 * "Fraud maintenance sweep" runbook entry.
 */
@Controller("v1/fraud/maintenance")
@UseGuards(JwtAuthGuard, TenantGuard, PlatformGuard, PermissionGuard)
export class FraudMaintenanceController {
  constructor(private readonly sweeper: FraudSweeperService) {}

  @Post("sweep")
  @HttpCode(200)
  @RequirePermissions("fraud.maintenance.run")
  sweep() {
    return this.sweeper.sweep();
  }
}
