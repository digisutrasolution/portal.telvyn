import { Injectable } from "@nestjs/common";
import type { TenantContext } from "@/authz/tenant-context";
import { normalizeE164 } from "@/telecom/dids/e164";
import { VelocityCounterService } from "../counters/velocity-counter.service";
import { SpendReservationService } from "../reservations/spend-reservation.service";
import { FraudAlertService } from "../alerts/fraud-alert.service";
import { FraudAuthorizationService } from "./fraud-authorization.service";
import type { FraudDecision, FraudDecisionReason } from "./fraud-decision";

/**
 * Call Authorization — the enforcing hook (Phase 12R-8, ADR-0021). The FIRST
 * slice that actually ENFORCES: it runs the toll-fraud decision AND commits the
 * side effects that make the limits real (places a reservation, advances the
 * velocity counters, acquires the concurrent-call gauge) on ALLOW, and records
 * an alert on DENY. It is the single entry point the live call path (an SBC /
 * softswitch, wired later behind the delivery model, TELECOM #2) calls to ask
 * "may this call proceed?".
 *
 * **Policy-only** this slice — kill-switch, geo/destination, spend limits, and
 * velocity. NO wallet/balance gate (that needs the prepaid-vs-postpaid decision,
 * DB-003, + the billing ledger, Phase 13); the hook composes to add it later.
 *
 * **Race-safe** — the authoritative stateful gates are evaluated AFTER the
 * atomic commit, not before: the concurrent-call gauge is checked against the
 * post-`acquire` count, and the period-spend caps against the post-`reserve`
 * reserved total, so simultaneous authorizations cannot each read "under limit"
 * and collectively overshoot. A breach compensates (releases what it took) and
 * denies. (The per-window CALLS_PER_* rate caps are still evaluated pre-commit —
 * a bounded, self-healing overshoot bounded by concurrency; the concurrent gauge
 * is the hard real-time cap.)
 *
 * **Fail-closed** — the commit needs Redis; any outage there propagates (→ 503)
 * after compensation, so the system denies rather than lets a call through
 * unmetered. The deliberate opposite is the alert path (fail-open, 12R-7).
 *
 * **Idempotent** on `callKey`: a retry of an already-authorized call returns the
 * same authorization without taking the side effects twice (the reservation row
 * is the authorization record + retry guard).
 *
 * Lifecycle: the caller reports the call's end so held resources are returned —
 * `completeCall` (settle the actual cost + release the concurrent gauge) or
 * `abandonCall` (release the hold + the gauge). An authorization that is never
 * finalized is swept by the reservation TTL (12R-6); the concurrent gauge for
 * such a leak self-heals on release-floor / a later reconcile.
 */

/** How long an authorized call holds its reservation before the TTL sweeper returns it (max call duration). */
const CALL_RESERVATION_TTL_SECONDS = 6 * 3600;

export interface AuthorizeCallInput {
  /** Idempotency key for this call attempt — the token used to settle/release it. */
  callKey: string;
  /** Raw dialled destination (normalized to E.164). */
  destinationRaw: string;
  /** Estimated cost of this call in integer micros (held against spend caps). */
  estimatedCostMicros?: number;
}

export interface CallAuthorization {
  decision: "ALLOW" | "DENY";
  /** Empty on ALLOW; the single decisive reason on DENY. */
  reasons: FraudDecisionReason[];
  destinationE164: string | null;
  destinationCountry: string | null;
  /** The token to settle/release this call — set on ALLOW, null on DENY. */
  callKey: string | null;
  /** The reservation holding this call's estimated cost — set on ALLOW, null on DENY. */
  reservationId: string | null;
}

@Injectable()
export class CallAuthorizationService {
  constructor(
    private readonly authorization: FraudAuthorizationService,
    private readonly counters: VelocityCounterService,
    private readonly reservations: SpendReservationService,
    private readonly alerts: FraudAlertService,
  ) {}

  /** Authorize a live call: decide, and on ALLOW commit the enforcing side effects. */
  async authorizeCall(ctx: TenantContext, input: AuthorizeCallInput): Promise<CallAuthorization> {
    // 1. Idempotency — a retry of an already-authorized call takes nothing twice.
    const existing = await this.reservations.find(ctx, input.callKey);
    if (existing) {
      if (existing.status === "ACTIVE") {
        const norm = normalizeE164(input.destinationRaw);
        return this.allow(input.callKey, existing.id, norm.ok ? norm.value.e164 : null, norm.ok ? norm.value.country : null);
      }
      // The key was already used and finalized (settled/released/expired).
      return this.deny([{ control: "idempotency", code: "DUPLICATE_CALL_KEY", message: "this call key was already finalized" }], null, null);
    }

    // 2. Decide (pre-state). A DENY here is a kill-switch / destination / per-call
    // spend / invalid-destination / fail-closed reject — no side effects taken.
    const { decision, velocityLimits, spendLimits } = await this.authorization.decide(ctx, {
      destinationRaw: input.destinationRaw,
      estimatedCostMicros: input.estimatedCostMicros,
    });
    if (decision.decision === "DENY") {
      await this.alerts.alertOnDecision(decision, { correlationId: input.callKey });
      return this.deny(decision.reasons, decision.destinationE164, decision.destinationCountry);
    }

    // 3. ALLOW (pre-state) — commit the enforcing side effects, race-safe + fail-closed.
    const estimate = input.estimatedCostMicros ?? 0;
    let reservationId: string | null = null;
    let acquired = false;
    try {
      const reservation = await this.reservations.reserve(ctx, {
        idempotencyKey: input.callKey,
        amountMicros: estimate,
        correlationId: input.callKey,
        ttlSeconds: CALL_RESERVATION_TTL_SECONDS,
      });
      reservationId = reservation.id;

      const concurrentNow = await this.counters.acquireConcurrent(ctx.tenantId);
      acquired = true;
      const concLimit = velocityLimits.find((v) => v.metric === "CONCURRENT_CALLS");
      if (concLimit && concurrentNow > concLimit.limit) {
        return await this.denyAfterCommit(ctx, input.callKey, decision, "velocity", "CONCURRENT_CALLS_EXCEEDED", acquired, reservationId !== null);
      }

      const periodCaps = spendLimits.filter((s) => s.period !== "PER_CALL");
      if (periodCaps.length > 0) {
        const reservedTotals = await this.reservations.readReserved(ctx.tenantId);
        for (const cap of periodCaps) {
          if ((reservedTotals[cap.period] ?? 0) > cap.amountMicros) {
            return await this.denyAfterCommit(ctx, input.callKey, decision, "spend", `${cap.period}_SPEND_EXCEEDED`, acquired, reservationId !== null);
          }
        }
      }

      // Committed within every cap — advance the rate windows for this call.
      await this.counters.recordCall(ctx.tenantId);
      return this.allow(input.callKey, reservationId, decision.destinationE164, decision.destinationCountry);
    } catch (e) {
      // Compensate any partial commit, then fail closed (propagate → 503).
      if (acquired) await this.counters.releaseConcurrent(ctx.tenantId).catch(() => undefined);
      if (reservationId !== null) await this.reservations.release(ctx, input.callKey).catch(() => undefined);
      throw e;
    }
  }

  /** The call completed: record the actual cost and release the concurrent gauge. Idempotent. */
  async completeCall(ctx: TenantContext, callKey: string, actualCostMicros: number): Promise<void> {
    await this.reservations.settle(ctx, callKey, actualCostMicros);
    await this.counters.releaseConcurrent(ctx.tenantId);
  }

  /** The call was never placed / failed: return the hold and the concurrent gauge. Idempotent. */
  async abandonCall(ctx: TenantContext, callKey: string): Promise<void> {
    await this.reservations.release(ctx, callKey);
    await this.counters.releaseConcurrent(ctx.tenantId);
  }

  /** Release what the commit took, raise the alert, and return the enforced DENY. */
  private async denyAfterCommit(
    ctx: TenantContext,
    callKey: string,
    base: FraudDecision,
    control: string,
    code: string,
    acquired: boolean,
    reserved: boolean,
  ): Promise<CallAuthorization> {
    if (acquired) await this.counters.releaseConcurrent(ctx.tenantId).catch(() => undefined);
    if (reserved) await this.reservations.release(ctx, callKey).catch(() => undefined);
    const denied: FraudDecision = {
      decision: "DENY",
      reasons: [{ control, code, message: `${code} (enforced at commit)` }],
      destinationE164: base.destinationE164,
      destinationCountry: base.destinationCountry,
    };
    await this.alerts.alertOnDecision(denied, { correlationId: callKey });
    return this.deny(denied.reasons, denied.destinationE164, denied.destinationCountry);
  }

  private allow(callKey: string, reservationId: string, e164: string | null, country: string | null): CallAuthorization {
    return { decision: "ALLOW", reasons: [], destinationE164: e164, destinationCountry: country, callKey, reservationId };
  }
  private deny(reasons: FraudDecisionReason[], e164: string | null, country: string | null): CallAuthorization {
    return { decision: "DENY", reasons, destinationE164: e164, destinationCountry: country, callKey: null, reservationId: null };
  }
}
