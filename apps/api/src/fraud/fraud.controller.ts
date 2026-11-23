import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ZodPipe } from "@/common/zod.pipe";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { TenantGuard } from "@/authz/tenant.guard";
import { PermissionGuard } from "@/authz/permission.guard";
import { RequirePermissions } from "@/authz/authz.decorators";
import { FraudEventsService } from "./fraud-events.service";
import { ListFraudEventsQuery, type ListFraudEventsInput } from "./fraud-events.dto";

/**
 * Fraud API (Phase 12R-1, ADR-0021). Read-only foundation: list the active
 * tenant's own fraud events. JWT + tenant + permission gated; isolation is
 * enforced by the tenant-scoping Prisma client, not a client-supplied field.
 * There is deliberately NO creation endpoint — fraud events are produced
 * internally by (future) controls, never by an external caller.
 */
@Controller("v1/fraud/events")
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class FraudController {
  constructor(private readonly events: FraudEventsService) {}

  @Get()
  @RequirePermissions("fraud.events.read")
  list(@Query(new ZodPipe(ListFraudEventsQuery)) query: ListFraudEventsInput) {
    return this.events.list(query);
  }
}
