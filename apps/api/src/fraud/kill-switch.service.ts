import { Injectable } from "@nestjs/common";
import { KillSwitchScope, type KillSwitch, Prisma } from "@prisma/client";
import { PrismaService } from "@/infra/prisma.service";
import { AuditService } from "@/authz/audit.service";
import type { TenantContext } from "@/authz/tenant-context";
import type { RequestContext } from "@/common/request-context";
import { FraudEventsService } from "./fraud-events.service";

/**
 * Kill-switch STATE (Phase 12R-3, ADR-0021) — the emergency brake. This slice
 * stores and toggles the switch; NOTHING reads or enforces it at call time yet
 * (no call authorization — later slices). Two scopes: GLOBAL (platform-wide,
 * tenantId null) and TENANT (a tenant's own calling). Dual-nature nullable
 * tenantId, so scoping is explicit here (not the auto-scoping client): GLOBAL is
 * reached only through the platform surface (PlatformGuard); TENANT is always
 * confined to the server-derived ctx.tenantId. Each toggle is audited and emits
 * a KILL_SWITCH FraudEvent. Step-up MFA on activation is deferred (enforcement).
 */
@Injectable()
export class KillSwitchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: FraudEventsService,
  ) {}

  private view(scope: KillSwitchScope, row: KillSwitch | null) {
    return {
      scope,
      active: row?.active ?? false,
      reason: row?.reason ?? null,
      version: row?.version ?? 0,
      activatedAt: row?.activatedAt ?? null,
      deactivatedAt: row?.deactivatedAt ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async getTenant(ctx: TenantContext) {
    const row = await this.prisma.killSwitch.findFirst({ where: { scope: KillSwitchScope.TENANT, tenantId: ctx.tenantId } });
    return this.view(KillSwitchScope.TENANT, row);
  }

  async getGlobal() {
    const row = await this.prisma.killSwitch.findFirst({ where: { scope: KillSwitchScope.GLOBAL, tenantId: null } });
    return this.view(KillSwitchScope.GLOBAL, row);
  }

  async setTenant(ctx: TenantContext, req: RequestContext, active: boolean, reason?: string) {
    const row = await this.ensureRow(KillSwitchScope.TENANT, ctx.tenantId);
    const updated = await this.toggle(row.id, active, reason, ctx.userId);
    await this.recordToggle(ctx, req, updated);
    return this.view(KillSwitchScope.TENANT, updated);
  }

  async setGlobal(ctx: TenantContext, req: RequestContext, active: boolean, reason?: string) {
    const row = await this.ensureRow(KillSwitchScope.GLOBAL, null);
    const updated = await this.toggle(row.id, active, reason, ctx.userId);
    await this.recordToggle(ctx, req, updated);
    return this.view(KillSwitchScope.GLOBAL, updated);
  }

  /** Find-or-create the single switch row for a (scope, tenantId). */
  private async ensureRow(scope: KillSwitchScope, tenantId: string | null): Promise<KillSwitch> {
    const existing = await this.prisma.killSwitch.findFirst({ where: { scope, tenantId } });
    if (existing) return existing;
    try {
      return await this.prisma.killSwitch.create({ data: { scope, tenantId, active: false } });
    } catch (e) {
      // Lost a create race on the (scope, tenantId) unique — re-load.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const row = await this.prisma.killSwitch.findFirst({ where: { scope, tenantId } });
        if (row) return row;
      }
      throw e;
    }
  }

  private async toggle(id: string, active: boolean, reason: string | undefined, userId: string): Promise<KillSwitch> {
    const now = new Date();
    return this.prisma.killSwitch.update({
      where: { id },
      data: {
        active,
        reason: reason ?? null,
        version: { increment: 1 },
        ...(active ? { activatedAt: now, activatedBy: userId } : { deactivatedAt: now, deactivatedBy: userId }),
      },
    });
  }

  /** Audit the admin action + emit a KILL_SWITCH FraudEvent (append-only history). */
  private async recordToggle(ctx: TenantContext, req: RequestContext, row: KillSwitch) {
    const action = row.active ? "activated" : "deactivated";
    await this.audit.log({
      ctx,
      req,
      action: `fraud.kill_switch.${action}`,
      resource: "kill_switch",
      resourceId: row.id,
      metadata: { scope: row.scope, active: row.active, reason: row.reason },
    });
    await this.events.record({
      type: "KILL_SWITCH",
      severity: row.active ? "CRITICAL" : "WARNING",
      source: "kill-switch",
      code: `KILL_SWITCH_${action.toUpperCase()}`,
      reason: row.reason ?? null,
      metadata: { scope: row.scope },
    });
  }
}
