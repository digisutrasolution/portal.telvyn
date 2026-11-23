import { Module } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import { AuthModule } from "@/auth/auth.module";
import { AuthzModule } from "@/authz/authz.module";
import { FraudController } from "./fraud.controller";
import { FraudEventsService } from "./fraud-events.service";
import { SpendLimitsController } from "./spend-limits.controller";
import { SpendLimitsService } from "./spend-limits.service";
import { VelocityLimitsController } from "./velocity-limits.controller";
import { VelocityLimitsService } from "./velocity-limits.service";
import { DestinationRulesController } from "./destination-rules.controller";
import { DestinationRulesService } from "./destination-rules.service";

/**
 * Fraud control plane (Phase 12R, ADR-0021).
 * 12R-1  — append-only fraud-event foundation + read API.
 * 12R-2a — spend-limit authoring (declarative config + CRUD API).
 * 12R-2b — velocity-limit authoring (declarative config + CRUD API).
 * 12R-2c — geo/destination-rule authoring (declarative config + CRUD API).
 * NO enforcement anywhere yet (no kill-switch control, no call authorization, no
 * rate/concurrency counting, no geo/destination evaluation, no reservation/
 * balance gate, no engine wiring). AuthzModule provides the guards +
 * AuditService; the tenant-scoping Prisma client enforces isolation.
 */
@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [FraudController, SpendLimitsController, VelocityLimitsController, DestinationRulesController],
  providers: [PrismaService, FraudEventsService, SpendLimitsService, VelocityLimitsService, DestinationRulesService],
  exports: [FraudEventsService, SpendLimitsService, VelocityLimitsService, DestinationRulesService],
})
export class FraudModule {}
