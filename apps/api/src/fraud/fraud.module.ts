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
import { CallAuthorizationService } from "./authorization/call-authorization.service";
import { FraudMaintenanceController } from "./maintenance/fraud-maintenance.controller";
import { FraudSweeperService } from "./maintenance/fraud-sweeper.service";
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
 * 12R-8  — call authorization (CallAuthorizationService): the ENFORCING hook —
 *          decide, then on ALLOW commit the side effects that make limits real
 *          (reserve + acquire the concurrent gauge + record the call, race-safe,
 *          fail-closed, idempotent) and on DENY alert; plus the settle/release
 *          lifecycle. Exposed as POST /v1/fraud/authorize (+ /complete,/abandon),
 *          gated by `fraud.call.authorize`. Policy-only (no wallet gate — DB-003).
 * 12R-9  — maintenance sweeper (FraudSweeperService): the SYSTEM reconcile that
 *          expires overdue holds AND returns their leaked concurrent-gauge counts,
 *          so an unfinalized call can't wedge a tenant's concurrent cap. Exposed
 *          PLATFORM-only as POST /v1/fraud/maintenance/sweep (`fraud.maintenance.run`),
 *          driven by an external scheduler (no in-process timer — it would fan out
 *          across instances).
 * The decision is ENFORCED through the 12R-8 hook; what remains is wiring a LIVE
 * call path to it (the SBC/softswitch behind the delivery model, TELECOM #2) —
 * no engine is contacted yet.
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
    FraudMaintenanceController,
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
    CallAuthorizationService,
    VelocityCounterService,
    SpendReservationService,
    FraudAlertService,
    FraudSweeperService,
  ],
  exports: [
    FraudEventsService,
    SpendLimitsService,
    VelocityLimitsService,
    DestinationRulesService,
    KillSwitchService,
    FraudAuthorizationService,
    CallAuthorizationService,
    VelocityCounterService,
    SpendReservationService,
    FraudAlertService,
  ],
})
export class FraudModule {}
