import type {
  DestinationAction,
  DestinationMatchType,
  DestinationRiskClass,
  SpendLimitPeriod,
  VelocityMetric,
} from "@prisma/client";
import { normalizeE164 } from "@/telecom/dids/e164";

/**
 * The fraud Authorization Decision evaluator (Phase 12R-4, ADR-0021) — a PURE
 * function over a policy snapshot. It performs NO I/O: loading the policies +
 * kill-switch and the live usage counters is the caller's job. This is the
 * single place the toll-fraud decision is expressed, so later slices (the real
 * call-authorization path with reservations + live counters, and ultimately the
 * owner-gated engine hook) all reuse it unchanged.
 *
 * It is NOT yet wired to a live call or an engine — nothing here enforces a
 * decision. Fail-closed (deny on store outage) is a property of the I/O layer
 * that feeds this function, not of the pure evaluator; the evaluator itself
 * denies on an unparseable destination and on any breached control.
 */

export type FraudDecisionOutcome = "ALLOW" | "DENY";

export interface FraudDecisionReason {
  /** The control that produced this reason, e.g. "kill-switch" | "destination" | "spend" | "velocity". */
  control: string;
  /** Short machine code, e.g. "TENANT_KILL_SWITCH_ACTIVE" | "PER_CALL_SPEND_EXCEEDED". */
  code: string;
  /** Safe human-readable explanation — never secrets. */
  message: string;
}

export interface FraudDecision {
  decision: FraudDecisionOutcome;
  /** Empty on ALLOW; the single decisive reason on DENY (evaluation short-circuits). */
  reasons: FraudDecisionReason[];
  /** The canonical destination, or null when it could not be parsed. */
  destinationE164: string | null;
  /** ISO-3166-1 alpha-2 country of the destination, or null. */
  destinationCountry: string | null;
}

export interface DestinationRuleSnapshot {
  matchType: DestinationMatchType;
  matchValue: string; // normalized: COUNTRY=uppercase alpha-2, PREFIX=digits
  action: DestinationAction;
  riskClass: DestinationRiskClass;
}
export interface SpendLimitSnapshot {
  period: SpendLimitPeriod;
  amountMicros: number;
  currency: string;
}
export interface VelocityLimitSnapshot {
  metric: VelocityMetric;
  limit: number;
}

export interface FraudDecisionInput {
  killSwitch: { global: boolean; tenant: boolean };
  /** Enabled destination rules only. */
  destinationRules: DestinationRuleSnapshot[];
  /** Enabled spend limits only. */
  spendLimits: SpendLimitSnapshot[];
  /** Enabled velocity limits only. */
  velocityLimits: VelocityLimitSnapshot[];
  /** Current usage. `counts` are live velocity counters (12R-5); `spentMicros` is the reserved total per period from the reservation ledger (12R-6). */
  usage: {
    spentMicros: Partial<Record<SpendLimitPeriod, number>>;
    counts: Partial<Record<VelocityMetric, number>>;
  };
  /**
   * Whether the live velocity counters could be read. Default true. When false
   * AND velocity limits exist, the decision fails closed (DENY) rather than
   * evaluating against unknown usage.
   */
  countersAvailable?: boolean;
  /**
   * Whether the spend-reservation ledger could be read. Default true. When false
   * AND a period (non-PER_CALL) spend limit exists, the decision fails closed
   * (DENY) rather than evaluating a period cap against an unknown reserved total.
   */
  reservationsAvailable?: boolean;
  request: {
    /** Raw dialled destination (normalized here). */
    destinationRaw: string;
    /** Estimated cost of this call in integer micros. */
    estimatedCostMicros?: number;
  };
}

function allow(e164: string, country: string): FraudDecision {
  return { decision: "ALLOW", reasons: [], destinationE164: e164, destinationCountry: country };
}
function deny(
  control: string,
  code: string,
  message: string,
  e164: string | null,
  country: string | null,
): FraudDecision {
  return { decision: "DENY", reasons: [{ control, code, message }], destinationE164: e164, destinationCountry: country };
}

/**
 * The most-specific matching destination rule decides: a matching PREFIX rule is
 * more specific than a COUNTRY rule, and a longer PREFIX beats a shorter one.
 * Its action (DENY → block, ALLOW → explicit allow) wins; no match → no opinion
 * (the per-tenant default action is a later policy envelope, so "no rule" passes
 * here). Returns a DENY reason or null.
 */
function evaluateDestinationRules(
  rules: DestinationRuleSnapshot[],
  country: string,
  digits: string,
): FraudDecisionReason | null {
  let best: DestinationRuleSnapshot | null = null;
  let bestSpecificity = -1;
  for (const r of rules) {
    let matches = false;
    let specificity = 0;
    if (r.matchType === "COUNTRY") {
      matches = r.matchValue === country;
      specificity = 0; // least specific
    } else {
      matches = digits.startsWith(r.matchValue);
      specificity = r.matchValue.length; // longer prefix = more specific
    }
    if (matches && specificity > bestSpecificity) {
      best = r;
      bestSpecificity = specificity;
    }
  }
  if (!best || best.action === "ALLOW") return null;
  return {
    control: "destination",
    code: best.matchType === "COUNTRY" ? "COUNTRY_DENIED" : "PREFIX_DENIED",
    message: `destination ${best.matchType.toLowerCase()} ${best.matchValue} is denied (risk ${best.riskClass})`,
  };
}

/** Decide whether a hypothetical call is allowed by the policy snapshot. Pure. */
export function decideFraud(input: FraudDecisionInput): FraudDecision {
  // 1. Kill-switch — the most decisive control, checked first.
  if (input.killSwitch.global) {
    return deny("kill-switch", "GLOBAL_KILL_SWITCH_ACTIVE", "the global kill-switch is active", null, null);
  }
  if (input.killSwitch.tenant) {
    return deny("kill-switch", "TENANT_KILL_SWITCH_ACTIVE", "the tenant kill-switch is active", null, null);
  }

  // 2. Destination normalization — can't evaluate geo/destination/spend without it.
  const norm = normalizeE164(input.request.destinationRaw);
  if (!norm.ok) {
    return deny("destination", "INVALID_DESTINATION", `destination is not a valid E.164 number: ${norm.reason}`, null, null);
  }
  const { e164, country } = norm.value;
  const digits = e164.replace(/^\+/, "");

  // 3. Geo/destination rules.
  const ruleReason = evaluateDestinationRules(input.destinationRules, country, digits);
  if (ruleReason) {
    return { decision: "DENY", reasons: [ruleReason], destinationE164: e164, destinationCountry: country };
  }

  // 4. Spend limits. The per-call cap is deterministic (needs no usage) and is
  // checked first; period caps need the reserved total from the ledger.
  const est = input.request.estimatedCostMicros ?? 0;
  for (const sl of input.spendLimits) {
    if (sl.period === "PER_CALL" && est > sl.amountMicros) {
      return deny("spend", "PER_CALL_SPEND_EXCEEDED", "estimated call cost exceeds the per-call spend limit", e164, country);
    }
  }
  // Fail closed: if a period cap is configured but the reservation ledger could
  // not be read, deny rather than evaluate against an unknown reserved total.
  const hasPeriodSpendLimit = input.spendLimits.some((sl) => sl.period !== "PER_CALL");
  if (hasPeriodSpendLimit && input.reservationsAvailable === false) {
    return deny("spend", "SPEND_RESERVATIONS_UNAVAILABLE", "spend reservation ledger is unavailable — failing closed", e164, country);
  }
  for (const sl of input.spendLimits) {
    if (sl.period === "PER_CALL") continue;
    const used = input.usage.spentMicros[sl.period] ?? 0;
    if (used + est > sl.amountMicros) {
      return deny("spend", `${sl.period}_SPEND_EXCEEDED`, `this call would exceed the ${sl.period.toLowerCase()} spend limit`, e164, country);
    }
  }

  // 5. Velocity limits. Fail closed: if limits are configured but the live
  // counters could not be read, deny rather than evaluate against unknown usage.
  if (input.velocityLimits.length > 0 && input.countersAvailable === false) {
    return deny("velocity", "COUNTERS_UNAVAILABLE", "velocity counters are unavailable — failing closed", e164, country);
  }
  // CONCURRENT_CALLS is a live gauge (deny when already at cap); the rate metrics
  // deny when adding this call would exceed the window limit.
  for (const vl of input.velocityLimits) {
    const count = input.usage.counts[vl.metric] ?? 0;
    const over = vl.metric === "CONCURRENT_CALLS" ? count >= vl.limit : count + 1 > vl.limit;
    if (over) {
      return deny("velocity", `${vl.metric}_EXCEEDED`, `this call would exceed the ${vl.metric} limit`, e164, country);
    }
  }

  // 6. Every control passed.
  return allow(e164, country);
}
