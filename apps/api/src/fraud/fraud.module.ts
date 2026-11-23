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

/**
 * Fraud control plane (Phase 12R, ADR-0021).
 * 12R-1  — append-only fraud-event foundation + read API.
 * 12R-2a — spend-limit authoring (declarative config + CRUD API).
 * 12R-2b — velocity-limit authoring (declarative config + CRUD API).
 * NO enforcement anywhere yet (no geo/destination/kill-switch control, no call
 * authorization, no rate/concurrency counting, no reservation/balance gate, no
 * engine wiring). AuthzModule provides the guards + AuditService; the
 * tenant-scoping Prisma client enforces isolation.
 */
@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [FraudController, SpendLimitsController, VelocityLimitsController],
  providers: [PrismaService, FraudEventsService, SpendLimitsService, VelocityLimitsService],
  exports: [FraudEventsService, SpendLimitsService, VelocityLimitsService],
})
export class FraudModule {}
