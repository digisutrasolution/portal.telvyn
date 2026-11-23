import { describe, it, expect, vi } from "vitest";
import { FraudAlertService } from "./fraud-alert.service";
import type { FraudEventsService } from "../fraud-events.service";
import type { RedisService } from "@/infra/redis.service";
import { runWithTenantContext, type TenantContext } from "@/authz/tenant-context";
import type { FraudDecision } from "../authorization/fraud-decision";

const ctx = { tenantId: "t1", userId: "u1", tenantType: "CUSTOMER", membershipId: "m1", permissions: new Set<string>() } as TenantContext;

function denyDecision(control: string, code: string, extra: Partial<FraudDecision> = {}): FraudDecision {
  return { decision: "DENY", reasons: [{ control, code, message: `${code} occurred` }], destinationE164: "+14155550123", destinationCountry: "US", ...extra };
}
function allowDecision(): FraudDecision {
  return { decision: "ALLOW", reasons: [], destinationE164: "+14155550123", destinationCountry: "US" };
}

function makeService(opts: { record?: ReturnType<typeof vi.fn>; set?: ReturnType<typeof vi.fn> } = {}) {
  const record = opts.record ?? vi.fn().mockResolvedValue(undefined);
  const set = opts.set ?? vi.fn().mockResolvedValue("OK"); // "OK" = first in window (not throttled)
  const events = { record } as unknown as FraudEventsService;
  const redis = { client: { set } } as unknown as RedisService;
  return { svc: new FraudAlertService(events, redis), record, set };
}

describe("FraudAlertService.alertOnDecision", () => {
  it("is a no-op on ALLOW (records nothing, never touches the throttle)", async () => {
    const { svc, record, set } = makeService();
    await runWithTenantContext(ctx, () => svc.alertOnDecision(allowDecision()));
    expect(record).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("records an AUTHORIZATION_DENIED alert mapped from the decisive reason", async () => {
    const { svc, record } = makeService();
    await runWithTenantContext(ctx, () => svc.alertOnDecision(denyDecision("spend", "DAILY_SPEND_EXCEEDED"), { correlationId: "call-1" }));
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "AUTHORIZATION_DENIED",
        severity: "WARNING",
        source: "spend",
        code: "DAILY_SPEND_EXCEEDED",
        reason: "DAILY_SPEND_EXCEEDED occurred",
        correlationId: "call-1",
        metadata: { destinationCountry: "US" },
      }),
    );
  });

  it("omits metadata when the destination country is unknown", async () => {
    const { svc, record } = makeService();
    await runWithTenantContext(ctx, () => svc.alertOnDecision(denyDecision("destination", "INVALID_DESTINATION", { destinationCountry: null })));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ metadata: undefined }));
  });

  it("escalates the kill-switch to CRITICAL", async () => {
    const { svc, record } = makeService();
    await runWithTenantContext(ctx, () => svc.alertOnDecision(denyDecision("kill-switch", "TENANT_KILL_SWITCH_ACTIVE")));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ severity: "CRITICAL" }));
  });

  it("escalates a fail-closed store outage to CRITICAL", async () => {
    const { svc, record } = makeService();
    await runWithTenantContext(ctx, () => svc.alertOnDecision(denyDecision("velocity", "COUNTERS_UNAVAILABLE")));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ severity: "CRITICAL" }));
    const { svc: svc2, record: record2 } = makeService();
    await runWithTenantContext(ctx, () => svc2.alertOnDecision(denyDecision("spend", "SPEND_RESERVATIONS_UNAVAILABLE")));
    expect(record2).toHaveBeenCalledWith(expect.objectContaining({ severity: "CRITICAL" }));
  });

  it("throttles a repeat alert for the same (tenant, code) within the window", async () => {
    const { svc, record } = makeService({ set: vi.fn().mockResolvedValue(null) }); // null = key already set
    await runWithTenantContext(ctx, () => svc.alertOnDecision(denyDecision("spend", "DAILY_SPEND_EXCEEDED")));
    expect(record).not.toHaveBeenCalled();
  });

  it("uses a SET NX EX throttle keyed by tenant + code", async () => {
    const { svc, set } = makeService();
    await runWithTenantContext(ctx, () => svc.alertOnDecision(denyDecision("velocity", "CALLS_PER_MINUTE_EXCEEDED")));
    expect(set).toHaveBeenCalledWith("fraud:alert:t1:CALLS_PER_MINUTE_EXCEEDED", "1", "EX", expect.any(Number), "NX");
  });

  it("fails OPEN — records the alert anyway when the throttle store is unreachable", async () => {
    const { svc, record } = makeService({ set: vi.fn().mockRejectedValue(new Error("down")) });
    await runWithTenantContext(ctx, () => svc.alertOnDecision(denyDecision("spend", "DAILY_SPEND_EXCEEDED")));
    expect(record).toHaveBeenCalledOnce();
  });

  it("refuses to raise an alert outside a tenant context", async () => {
    const { svc } = makeService();
    await expect(svc.alertOnDecision(denyDecision("spend", "DAILY_SPEND_EXCEEDED"))).rejects.toThrow(/tenant context/);
  });
});
