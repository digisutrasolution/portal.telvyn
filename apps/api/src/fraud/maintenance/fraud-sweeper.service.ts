import { Injectable } from "@nestjs/common";
import { SpendReservationService } from "../reservations/spend-reservation.service";
import { VelocityCounterService } from "../counters/velocity-counter.service";

/**
 * Fraud maintenance sweeper (Phase 12R-9, ADR-0021) — the periodic reconcile that
 * returns resources held by calls that were authorized but never finalized (the
 * caller crashed, the engine never reported the call's end, etc.).
 *
 * An authorized call (12R-8) holds TWO things: a spend reservation and one
 * concurrent-call gauge count. `completeCall`/`abandonCall` return both. When
 * neither is reported, the reservation's TTL is the backstop: this sweep marks
 * overdue ACTIVE reservations EXPIRED (returning their spend hold) AND releases
 * the matching concurrent-gauge count, so a leak cannot silently wedge a tenant's
 * concurrent-call cap at the ceiling forever.
 *
 * SYSTEM, cross-tenant, idempotent, best-effort on the gauge. It owns NO schedule
 * of its own: an in-process timer would fire on every instance of a horizontally
 * scaled, stateless service (and the `updateMany` guard makes concurrent sweeps
 * safe but wasteful), so scheduling is external — an ops cron / k8s CronJob hits
 * the platform-gated sweep endpoint (see docs/RUNBOOK.md).
 */
export interface SweepResult {
  /** Reservations whose TTL elapsed while still ACTIVE, marked EXPIRED this run. */
  expiredReservations: number;
  /** Concurrent-gauge counts returned for those expired (leaked) calls. */
  concurrentReleased: number;
}

@Injectable()
export class FraudSweeperService {
  constructor(
    private readonly reservations: SpendReservationService,
    private readonly counters: VelocityCounterService,
  ) {}

  /** Expire overdue holds and return their spend + concurrent-gauge resources. */
  async sweep(batch = 500): Promise<SweepResult> {
    // expireDue returns one tenantId per expired hold (and has already returned
    // each one's SPEND gauge); release the matching concurrent-gauge count here.
    const expiredTenantIds = await this.reservations.expireDue(new Date(), batch);
    let concurrentReleased = 0;
    for (const tenantId of expiredTenantIds) {
      await this.counters.releaseConcurrent(tenantId); // best-effort (floors at 0)
      concurrentReleased += 1;
    }
    return { expiredReservations: expiredTenantIds.length, concurrentReleased };
  }
}
