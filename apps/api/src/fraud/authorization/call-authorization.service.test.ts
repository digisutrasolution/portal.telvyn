import { describe, it, expect, vi } from "vitest";
import { CallAuthorizationService } from "./call-authorization.service";
import type { FraudAuthorizationService, DecisionResult } from "./fraud-authorization.service";
import type { VelocityCounterService } from "../counters/velocity-counter.service";
import type { SpendReservationService, SpendReservationView } from "../reservations/spend-reservation.service";
import type { FraudAlertService } from "../alerts/fraud-alert.service";
import type { TenantContext } from "@/authz/tenant-context";
import type { FraudDecision } from "./fraud-decision";

const ctx = { tenantId: "t1", userId: "u1" } as TenantContext;
const DEST = "+14155550123";

function allowDecision(): FraudDecision {
  return { decision: "ALLOW", reasons: [], destinationE164: DEST, destinationCountry: "US" };
}
function denyDecision(control: string, code: string): FraudDecision {
  return { decision: "DENY", reasons: [{ control, code, message: `${code} msg` }], destinationE164: DEST, destinationCountry: "US" };
}
function reservationView(over: Partial<SpendReservationView> = {}): SpendReservationView {
  return { id: "resv-1", idempotencyKey: "call-1", amountMicros: 1000, settledMicros: null, currency: "USD", status: "ACTIVE", correlationId: "call-1", expiresAt: new Date(), createdAt: new Date(), ...over };
}

interface Mocks {
  decide?: ReturnType<typeof vi.fn>;
  find?: ReturnType<typeof vi.fn>;
  reserve?: ReturnType<typeof vi.fn>;
  readReserved?: ReturnType<typeof vi.fn>;
  release?: ReturnType<typeof vi.fn>;
  settle?: ReturnType<typeof vi.fn>;
  acquireConcurrent?: ReturnType<typeof vi.fn>;
  recordCall?: ReturnType<typeof vi.fn>;
  releaseConcurrent?: ReturnType<typeof vi.fn>;
  alertOnDecision?: ReturnType<typeof vi.fn>;
}
function make(m: Mocks = {}) {
  const decide = m.decide ?? vi.fn().mockResolvedValue({ decision: allowDecision(), velocityLimits: [], spendLimits: [] } satisfies DecisionResult);
  const find = m.find ?? vi.fn().mockResolvedValue(null);
  const reserve = m.reserve ?? vi.fn().mockResolvedValue(reservationView());
  const readReserved = m.readReserved ?? vi.fn().mockResolvedValue({});
  const release = m.release ?? vi.fn().mockResolvedValue(undefined);
  const settle = m.settle ?? vi.fn().mockResolvedValue(undefined);
  const acquireConcurrent = m.acquireConcurrent ?? vi.fn().mockResolvedValue(1);
  const recordCall = m.recordCall ?? vi.fn().mockResolvedValue(undefined);
  const releaseConcurrent = m.releaseConcurrent ?? vi.fn().mockResolvedValue(undefined);
  const alertOnDecision = m.alertOnDecision ?? vi.fn().mockResolvedValue(undefined);

  const authorization = { decide } as unknown as FraudAuthorizationService;
  const counters = { acquireConcurrent, recordCall, releaseConcurrent } as unknown as VelocityCounterService;
  const reservations = { find, reserve, readReserved, release, settle } as unknown as SpendReservationService;
  const alerts = { alertOnDecision } as unknown as FraudAlertService;
  const svc = new CallAuthorizationService(authorization, counters, reservations, alerts);
  return { svc, decide, find, reserve, readReserved, release, settle, acquireConcurrent, recordCall, releaseConcurrent, alertOnDecision };
}

const input = { callKey: "call-1", destinationRaw: DEST, estimatedCostMicros: 1000 };

describe("CallAuthorizationService.authorizeCall — idempotency", () => {
  it("replays an already-ACTIVE authorization without taking side effects again", async () => {
    const { svc, decide, reserve, acquireConcurrent, recordCall } = make({ find: vi.fn().mockResolvedValue(reservationView({ id: "resv-9" })) });
    const r = await svc.authorizeCall(ctx, input);
    expect(r).toMatchObject({ decision: "ALLOW", callKey: "call-1", reservationId: "resv-9", destinationE164: DEST });
    expect(decide).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(acquireConcurrent).not.toHaveBeenCalled();
    expect(recordCall).not.toHaveBeenCalled();
  });

  it("denies a reused key whose call already finalized (DUPLICATE_CALL_KEY)", async () => {
    const { svc, decide } = make({ find: vi.fn().mockResolvedValue(reservationView({ status: "SETTLED" })) });
    const r = await svc.authorizeCall(ctx, input);
    expect(r.decision).toBe("DENY");
    expect(r.reasons[0].code).toBe("DUPLICATE_CALL_KEY");
    expect(r.callKey).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });
});

describe("CallAuthorizationService.authorizeCall — decide (pre-state)", () => {
  it("denies and alerts on a pre-state DENY, taking NO side effects", async () => {
    const { svc, reserve, acquireConcurrent, alertOnDecision } = make({
      decide: vi.fn().mockResolvedValue({ decision: denyDecision("kill-switch", "TENANT_KILL_SWITCH_ACTIVE"), velocityLimits: [], spendLimits: [] }),
    });
    const r = await svc.authorizeCall(ctx, input);
    expect(r.decision).toBe("DENY");
    expect(r.reasons[0].code).toBe("TENANT_KILL_SWITCH_ACTIVE");
    expect(reserve).not.toHaveBeenCalled();
    expect(acquireConcurrent).not.toHaveBeenCalled();
    expect(alertOnDecision).toHaveBeenCalledOnce();
  });
});

describe("CallAuthorizationService.authorizeCall — ALLOW commit", () => {
  it("reserves, acquires the concurrent gauge, and records the call on ALLOW", async () => {
    const { svc, reserve, acquireConcurrent, recordCall, release, releaseConcurrent, alertOnDecision } = make();
    const r = await svc.authorizeCall(ctx, input);
    expect(r).toMatchObject({ decision: "ALLOW", callKey: "call-1", reservationId: "resv-1" });
    expect(reserve).toHaveBeenCalledWith(ctx, expect.objectContaining({ idempotencyKey: "call-1", amountMicros: 1000 }));
    expect(acquireConcurrent).toHaveBeenCalledOnce();
    expect(recordCall).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    expect(releaseConcurrent).not.toHaveBeenCalled();
    expect(alertOnDecision).not.toHaveBeenCalled();
  });

  it("enforces the concurrent cap on the POST-acquire count, compensating + alerting on breach", async () => {
    const { svc, release, releaseConcurrent, recordCall, alertOnDecision } = make({
      decide: vi.fn().mockResolvedValue({ decision: allowDecision(), velocityLimits: [{ metric: "CONCURRENT_CALLS", limit: 3 }], spendLimits: [] }),
      acquireConcurrent: vi.fn().mockResolvedValue(4), // over the cap of 3
    });
    const r = await svc.authorizeCall(ctx, input);
    expect(r.decision).toBe("DENY");
    expect(r.reasons[0].code).toBe("CONCURRENT_CALLS_EXCEEDED");
    expect(releaseConcurrent).toHaveBeenCalledOnce(); // compensated
    expect(release).toHaveBeenCalledOnce(); // reservation returned
    expect(recordCall).not.toHaveBeenCalled();
    expect(alertOnDecision).toHaveBeenCalledOnce();
  });

  it("enforces a period spend cap on the POST-reserve reserved total, compensating + alerting", async () => {
    const { svc, release, releaseConcurrent, recordCall } = make({
      decide: vi.fn().mockResolvedValue({ decision: allowDecision(), velocityLimits: [], spendLimits: [{ period: "DAILY", amountMicros: 1000, currency: "USD" }] }),
      readReserved: vi.fn().mockResolvedValue({ DAILY: 5000 }), // over the cap
    });
    const r = await svc.authorizeCall(ctx, input);
    expect(r.decision).toBe("DENY");
    expect(r.reasons[0].code).toBe("DAILY_SPEND_EXCEEDED");
    expect(release).toHaveBeenCalledOnce();
    expect(releaseConcurrent).toHaveBeenCalledOnce();
    expect(recordCall).not.toHaveBeenCalled();
  });

  it("fails closed and compensates when a counter write throws (Redis down)", async () => {
    const { svc, release } = make({ acquireConcurrent: vi.fn().mockRejectedValue(new Error("redis down")) });
    await expect(svc.authorizeCall(ctx, input)).rejects.toThrow("redis down");
    expect(release).toHaveBeenCalledOnce(); // the reservation taken before the throw is returned
  });
});

describe("CallAuthorizationService lifecycle", () => {
  it("completeCall settles the actual cost and releases the gauge", async () => {
    const { svc, settle, releaseConcurrent } = make();
    await svc.completeCall(ctx, "call-1", 777);
    expect(settle).toHaveBeenCalledWith(ctx, "call-1", 777);
    expect(releaseConcurrent).toHaveBeenCalledOnce();
  });

  it("abandonCall releases the hold and the gauge", async () => {
    const { svc, release, releaseConcurrent } = make();
    await svc.abandonCall(ctx, "call-1");
    expect(release).toHaveBeenCalledWith(ctx, "call-1");
    expect(releaseConcurrent).toHaveBeenCalledOnce();
  });
});
