import { Injectable } from "@nestjs/common";
import type { FraudEventSeverity } from "@prisma/client";
import { RedisService } from "@/infra/redis.service";
import { getTenantContext } from "@/authz/tenant-context";
import { FraudEventsService } from "../fraud-events.service";
import type { FraudDecision } from "../authorization/fraud-decision";

/**
 * Fraud alerting (Phase 12R-7, ADR-0021) — the "alert → RUNBOOK" path (SEC-002).
 * Turns a toll-fraud decision DENY into an append-only, queryable `FraudEvent`
 * so the on-call can see and act on it (see docs/RUNBOOK.md). It records only;
 * it never changes a decision and enforces nothing.
 *
 * **Fail-OPEN** (the deliberate inverse of the enforcement path): the throttle
 * is best-effort — if Redis cannot be reached we record the alert anyway rather
 * than risk dropping a fraud signal. Losing an alert is worse than a duplicate.
 *
 * **Throttle**: at most one alert per (tenant, code) per window, so a flood of
 * identical denials cannot firehose the event store. System-raised (no actor →
 * FraudEvent only, never an AuditLog per event, per ADR-0010).
 *
 * NOTE: nothing calls this at decision time yet. The dry-run preview (12R-4/5/6)
 * deliberately does NOT alert — its decisions are hypothetical. The real
 * call-authorization path (12R-8) calls `alertOnDecision` after a denied call.
 * This slice builds + tests the mechanism and documents the operator response.
 */

/** One alert per (tenant, code) per this many seconds. */
const ALERT_THROTTLE_SECONDS = 60;

/** CRITICAL alerts: the kill-switch, and a fail-closed store outage (calls are being denied for lack of a usage store). */
const CRITICAL_CODES = new Set(["COUNTERS_UNAVAILABLE", "SPEND_RESERVATIONS_UNAVAILABLE"]);

@Injectable()
export class FraudAlertService {
  constructor(
    private readonly events: FraudEventsService,
    private readonly redis: RedisService,
  ) {}

  private throttleKey(tenantId: string, code: string): string {
    return `fraud:alert:${tenantId}:${code}`;
  }

  /**
   * Record an AUTHORIZATION_DENIED alert for a denied decision. No-op on ALLOW.
   * Throttled per (tenant, code); fail-open on a throttle-store outage.
   */
  async alertOnDecision(decision: FraudDecision, opts: { correlationId?: string | null } = {}): Promise<void> {
    if (decision.decision !== "DENY") return;
    const reason = decision.reasons[0];
    if (!reason) return; // a DENY always carries its decisive reason; guard anyway

    const ctx = getTenantContext();
    if (!ctx) throw new Error("fraud alert raised without a tenant context");

    if (await this.isThrottled(ctx.tenantId, reason.code)) return;

    await this.events.record({
      type: "AUTHORIZATION_DENIED",
      severity: this.severityFor(reason.control, reason.code),
      source: reason.control,
      code: reason.code,
      reason: reason.message,
      correlationId: opts.correlationId ?? null,
      // Bounded, non-PII context: the destination country is useful for triage.
      metadata: decision.destinationCountry ? { destinationCountry: decision.destinationCountry } : undefined,
    });
  }

  private severityFor(control: string, code: string): FraudEventSeverity {
    if (control === "kill-switch" || CRITICAL_CODES.has(code)) return "CRITICAL";
    return "WARNING";
  }

  /**
   * True when an alert for this (tenant, code) was already raised in the current
   * window. Fail-OPEN: a Redis error returns false so the alert is still
   * recorded — a dropped fraud signal is worse than a duplicate.
   */
  private async isThrottled(tenantId: string, code: string): Promise<boolean> {
    try {
      // SET key 1 EX window NX → "OK" when newly set (first in window → NOT
      // throttled), null when it already exists (throttle this one).
      const res = await this.redis.client.set(this.throttleKey(tenantId, code), "1", "EX", ALERT_THROTTLE_SECONDS, "NX");
      return res !== "OK";
    } catch {
      return false; // fail-open
    }
  }
}
