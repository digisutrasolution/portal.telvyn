import { Module } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import { AuthModule } from "@/auth/auth.module";
import { AuthzModule } from "@/authz/authz.module";
import { FraudController } from "./fraud.controller";
import { FraudEventsService } from "./fraud-events.service";

/**
 * Fraud control plane (Phase 12R, ADR-0021).
 * 12R-1 — append-only fraud-event foundation + read API. NO enforcement
 *         (no spend/velocity/geo/destination/kill-switch control, no call
 *         authorization, no engine wiring). AuthzModule provides the guards +
 *         AuditService; the tenant-scoping Prisma client enforces isolation.
 */
@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [FraudController],
  providers: [PrismaService, FraudEventsService],
  exports: [FraudEventsService],
})
export class FraudModule {}
