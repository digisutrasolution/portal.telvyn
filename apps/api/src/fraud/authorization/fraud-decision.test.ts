import { describe, it, expect } from "vitest";
import { decideFraud, type FraudDecisionInput } from "./fraud-decision";

/** A baseline input that ALLOWs — individual tests override one slice at a time. */
function base(overrides: Partial<FraudDecisionInput> = {}): FraudDecisionInput {
  return {
    killSwitch: { global: false, tenant: false },
    destinationRules: [],
    spendLimits: [],
    velocityLimits: [],
    usage: { spentMicros: {}, counts: {} },
    request: { destinationRaw: "+14155550123", estimatedCostMicros: 1_000 },
    ...overrides,
  };
}

describe("decideFraud — baseline", () => {
  it("ALLOWs a well-formed call when no policy blocks it, echoing the normalized destination", () => {
    const d = decideFraud(base());
    expect(d.decision).toBe("ALLOW");
    expect(d.reasons).toEqual([]);
    expect(d.destinationE164).toBe("+14155550123");
    expect(d.destinationCountry).toBe("US");
  });
});

describe("decideFraud — kill-switch (most decisive, before parsing)", () => {
  it("DENYs on the global kill-switch", () => {
    const d = decideFraud(base({ killSwitch: { global: true, tenant: false } }));
    expect(d.decision).toBe("DENY");
    expect(d.reasons[0].code).toBe("GLOBAL_KILL_SWITCH_ACTIVE");
  });
  it("DENYs on the tenant kill-switch", () => {
    const d = decideFraud(base({ killSwitch: { global: false, tenant: true } }));
    expect(d.reasons[0].code).toBe("TENANT_KILL_SWITCH_ACTIVE");
  });
  it("global takes precedence over tenant", () => {
    const d = decideFraud(base({ killSwitch: { global: true, tenant: true } }));
    expect(d.reasons[0].code).toBe("GLOBAL_KILL_SWITCH_ACTIVE");
  });
});

describe("decideFraud — destination normalization", () => {
  it("DENYs an unparseable destination", () => {
    const d = decideFraud(base({ request: { destinationRaw: "not-a-number" } }));
    expect(d.decision).toBe("DENY");
    expect(d.reasons[0].code).toBe("INVALID_DESTINATION");
    expect(d.destinationE164).toBeNull();
  });
  it("DENYs a national-format (no +) destination — country is ambiguous", () => {
    const d = decideFraud(base({ request: { destinationRaw: "4155550123" } }));
    expect(d.reasons[0].code).toBe("INVALID_DESTINATION");
  });
});

describe("decideFraud — geo/destination rules (most-specific wins)", () => {
  it("DENYs a denied country", () => {
    const d = decideFraud(base({ destinationRules: [{ matchType: "COUNTRY", matchValue: "US", action: "DENY", riskClass: "STANDARD" }] }));
    expect(d.decision).toBe("DENY");
    expect(d.reasons[0].code).toBe("COUNTRY_DENIED");
  });
  it("DENYs a denied prefix (more specific than country)", () => {
    const d = decideFraud(
      base({
        request: { destinationRaw: "+19005550123" },
        destinationRules: [{ matchType: "PREFIX", matchValue: "1900", action: "DENY", riskClass: "PREMIUM" }],
      }),
    );
    expect(d.reasons[0].code).toBe("PREFIX_DENIED");
  });
  it("a specific ALLOW prefix overrides a broader country DENY", () => {
    const d = decideFraud(
      base({
        request: { destinationRaw: "+18005550123" },
        destinationRules: [
          { matchType: "COUNTRY", matchValue: "US", action: "DENY", riskClass: "STANDARD" },
          { matchType: "PREFIX", matchValue: "1800", action: "ALLOW", riskClass: "STANDARD" },
        ],
      }),
    );
    expect(d.decision).toBe("ALLOW");
  });
  it("the longer matching prefix wins", () => {
    const d = decideFraud(
      base({
        request: { destinationRaw: "+19005550123" },
        destinationRules: [
          { matchType: "PREFIX", matchValue: "1", action: "ALLOW", riskClass: "STANDARD" },
          { matchType: "PREFIX", matchValue: "1900", action: "DENY", riskClass: "PREMIUM" },
        ],
      }),
    );
    expect(d.decision).toBe("DENY");
    expect(d.reasons[0].code).toBe("PREFIX_DENIED");
  });
});

describe("decideFraud — spend limits", () => {
  it("DENYs when the estimate exceeds the per-call cap", () => {
    const d = decideFraud(
      base({ request: { destinationRaw: "+14155550123", estimatedCostMicros: 5_000 }, spendLimits: [{ period: "PER_CALL", amountMicros: 1_000, currency: "USD" }] }),
    );
    expect(d.reasons[0].code).toBe("PER_CALL_SPEND_EXCEEDED");
  });
  it("DENYs when usage + estimate exceeds the daily cap", () => {
    const d = decideFraud(
      base({
        request: { destinationRaw: "+14155550123", estimatedCostMicros: 500 },
        spendLimits: [{ period: "DAILY", amountMicros: 1_000, currency: "USD" }],
        usage: { spentMicros: { DAILY: 800 }, counts: {} },
      }),
    );
    expect(d.reasons[0].code).toBe("DAILY_SPEND_EXCEEDED");
  });
  it("ALLOWs when usage + estimate is within the monthly cap", () => {
    const d = decideFraud(
      base({
        request: { destinationRaw: "+14155550123", estimatedCostMicros: 100 },
        spendLimits: [{ period: "MONTHLY", amountMicros: 1_000, currency: "USD" }],
        usage: { spentMicros: { MONTHLY: 800 }, counts: {} },
      }),
    );
    expect(d.decision).toBe("ALLOW");
  });
});

describe("decideFraud — velocity limits", () => {
  it("DENYs when adding this call exceeds a rate limit", () => {
    const d = decideFraud(
      base({ velocityLimits: [{ metric: "CALLS_PER_MINUTE", limit: 5 }], usage: { spentMicros: {}, counts: { CALLS_PER_MINUTE: 5 } } }),
    );
    expect(d.reasons[0].code).toBe("CALLS_PER_MINUTE_EXCEEDED");
  });
  it("DENYs when already at the concurrent-call cap", () => {
    const d = decideFraud(
      base({ velocityLimits: [{ metric: "CONCURRENT_CALLS", limit: 3 }], usage: { spentMicros: {}, counts: { CONCURRENT_CALLS: 3 } } }),
    );
    expect(d.reasons[0].code).toBe("CONCURRENT_CALLS_EXCEEDED");
  });
  it("ALLOWs when below the limit", () => {
    const d = decideFraud(
      base({ velocityLimits: [{ metric: "CALLS_PER_HOUR", limit: 100 }], usage: { spentMicros: {}, counts: { CALLS_PER_HOUR: 10 } } }),
    );
    expect(d.decision).toBe("ALLOW");
  });
});

describe("decideFraud — velocity fail-closed", () => {
  it("DENYs when velocity limits exist but the counters are unavailable", () => {
    const d = decideFraud(base({ velocityLimits: [{ metric: "CALLS_PER_MINUTE", limit: 5 }], countersAvailable: false }));
    expect(d.decision).toBe("DENY");
    expect(d.reasons[0]).toMatchObject({ control: "velocity", code: "COUNTERS_UNAVAILABLE" });
  });
  it("ALLOWs when counters are unavailable but no velocity limit is configured", () => {
    const d = decideFraud(base({ countersAvailable: false }));
    expect(d.decision).toBe("ALLOW");
  });
});

describe("decideFraud — ordering", () => {
  it("kill-switch is reported even when other controls would also fail", () => {
    const d = decideFraud(
      base({
        killSwitch: { global: false, tenant: true },
        destinationRules: [{ matchType: "COUNTRY", matchValue: "US", action: "DENY", riskClass: "STANDARD" }],
        spendLimits: [{ period: "PER_CALL", amountMicros: 1, currency: "USD" }],
      }),
    );
    expect(d.reasons[0].code).toBe("TENANT_KILL_SWITCH_ACTIVE");
  });
});
