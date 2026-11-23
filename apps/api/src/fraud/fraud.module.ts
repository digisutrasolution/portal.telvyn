import { Module } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import { RedisService } from "@/infra/redis.service";
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
import { KillSwitchController, GlobalKillSwitchController } from "./kill-switch.controller";
import { KillSwitchService } from "./kill-switch.service";
import { FraudAuthorizationController } from "./authorization/authorization.controller";
import { FraudAuthorizationService } from "./authorization/fraud-authorization.service";
import { VelocityCounterService } from "./counters/velocity-counter.service";
import { SpendReservationService } from "./reservations/spend-reservation.service";
import { FraudAlertService } from "./alerts/fraud-alert.service";

/**
 * Fraud control plane (Phase 12R, ADR-0021).
 * 12R-1  — append-only fraud-event foundation + read API.
 * 12R-2a — spend-limit authoring (declarative config + CRUD API).
 * 12R-2b — velocity-limit authoring (declarative config + CRUD API).
 * 12R-2c — geo/destination-rule authoring (declarative config + CRUD API).
 * 12R-3  — kill-switch state (GLOBAL + TENANT; toggle + audit + FraudEvent).
 * 12R-4  — Authorization Decision Service: a PURE decision evaluator + a DRY-RUN
 *          preview that consumes the policies + kill-switch.
 * 12R-5  — live velocity counters (Redis windows + concurrent gauge, fail-closed)
 *          wired into the decision's velocity check.
 * 12R-6  — spend-reservation ledger (durable SpendReservation rows + a Redis
 *          per-period reserved-micros gauge, fail-closed) wired into the
 *          decision's period-spend check.
 * 12R-7  — fraud alerting (FraudAlertService): a decision DENY → an append-only
 *          AUTHORIZATION_DENIED FraudEvent, Redis-throttled per (tenant, code),
 *          FAIL-OPEN. The "alert → RUNBOOK" path (docs/RUNBOOK.md). Records only.
 * Still NO call-time enforcement — the preview is a dry run, nothing places a
 * reservation, increments a counter, or RAISES AN ALERT at call time yet, and no
 * engine is wired. The real call-authorization path (reserve on authorize,
 * settle/release on call end, alert on deny) + the TTL sweeper job are later
 * slices (12R-8+).
 * AuthzModule provides the guards + AuditService; the tenant-scoping Prisma
 * client enforces isolation.
 */
@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [
    FraudController,
    SpendLimitsController,
    VelocityLimitsController,
    DestinationRulesController,
    KillSwitchController,
    GlobalKillSwitchController,
    FraudAuthorizationController,
  ],
  providers: [
    PrismaService,
    RedisService,
    FraudEventsService,
    SpendLimitsService,
    VelocityLimitsService,
    DestinationRulesService,
    KillSwitchService,
    FraudAuthorizationService,
    VelocityCounterService,
    SpendReservationService,
    FraudAlertService,
  ],
  exports: [
    FraudEventsService,
    SpendLimitsService,
    VelocityLimitsService,
    DestinationRulesService,
    KillSwitchService,
    FraudAuthorizationService,
    VelocityCounterService,
    SpendReservationService,
    FraudAlertService,
  ],
})
export class FraudModule {}
