/**
 * Typed internal ledger-posting contract (Phase 13-1D).
 *
 * Mirrors the ACCEPTED, MERGED database contract `billing.ledger_post(payload
 * jsonb) RETURNS uuid` exactly — it does not invent fields or modify the SQL.
 * Three concerns live here:
 *   1. TrustedLedgerContext — the unforgeable authorization boundary (§13/§14).
 *   2. computeFingerprint — the canonical idempotency fingerprint (§20) the DB
 *      function STORES and COMPARES (it does not compute one); it must be built
 *      at this trusted boundary, never accepted from an untrusted request.
 *   3. buildLedgerPostPayload — the jsonb payload, assembled ONLY from validated
 *      typed values (never a raw caller-supplied object), with amounts serialized
 *      as exact integer-micros strings (§11 — no BigInt/number into JSON).
 */
import type { Currency } from "@prisma/client";
import { sha256 } from "@/common/crypto.util";
import { LedgerError } from "./ledger-errors";
import { type Micros, MoneyError, assertValidLegAmount, serializeMicros, formatMicrosToDecimal } from "./money";

/** Pinned fingerprint algorithm version (SHA-256 over the canonical form below). */
export const FINGERPRINT_VERSION = 1;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(value: string, field: string): void {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new LedgerError("MISSING_AUTHORIZATION_CONTEXT", `invalid uuid for ${field}`);
  }
}

// ======================= Trusted authorization context =======================
const TRUSTED = Symbol("telvyn.billing.trustedLedgerContext");

/**
 * Module-private capability registry (the real provenance authority). A context
 * is genuine ONLY if THIS module minted it and registered it here. A spread,
 * clone, `Object.assign`, or any object a caller builds — even one that copies
 * the brand symbol via `Object.getOwnPropertySymbols`/`Reflect.ownKeys` — is a
 * DIFFERENT object reference, is not in the WeakSet, and is rejected. The WeakSet
 * is never exported, so external code cannot register a forgery, and it holds
 * only weak references (no leak).
 */
const REGISTRY = new WeakSet<object>();

/** Ownership of a ledger transaction: a specific tenant, or the platform. */
export type LedgerOwner = { readonly kind: "tenant"; readonly tenantId: string } | { readonly kind: "platform" };

/**
 * An authorization token the posting service REQUIRES before it will touch the
 * database. Provenance is enforced at RUNTIME by the module-private WeakSet
 * REGISTRY above (not merely the Symbol brand, which a spread/clone could copy):
 * a value is a genuine context only if this module minted it. This is the
 * structural, fail-closed boundary (§14): the DB posting function is reachable
 * only through the service, and the service is reachable only with one of these,
 * which only this module constructs from VALIDATED identity. `operation` names
 * the authorized server operation; `owner`/`actorId` are the server-established
 * financial identity (never caller-supplied). Fields are deeply frozen — the
 * context cannot be mutated after authorization.
 */
export interface TrustedLedgerContext {
  readonly [TRUSTED]: true;
  readonly owner: LedgerOwner;
  readonly actorId: string | null;
  readonly operation: string;
}

/**
 * The ONLY constructor of a TrustedLedgerContext. It validates the structure of
 * the server-established identity. It is NOT an authorization decision in itself:
 * callers MUST have already authorized the operation against the trusted server
 * context (the commercial permission matrix is DEFERRED — ADR-0022 "Open
 * decisions"). In this slice NO production operation calls this (the service is
 * inert); integration tests call it via an explicit test-only fixture. A
 * caller-settable `authorized: true` flag is deliberately NOT accepted — the
 * brand, the absence of any production caller, and the absence of a public
 * endpoint are the boundary, not a boolean.
 */
export function createTrustedLedgerContext(params: {
  owner: LedgerOwner;
  actorId: string | null;
  operation: string;
}): TrustedLedgerContext {
  if (params.owner.kind === "tenant") assertUuid(params.owner.tenantId, "owner.tenantId");
  if (params.actorId !== null) assertUuid(params.actorId, "actorId");
  if (typeof params.operation !== "string" || params.operation.trim().length === 0) {
    throw new LedgerError("MISSING_AUTHORIZATION_CONTEXT", "a ledger operation name is required");
  }
  // Fresh, deeply-frozen fields (the caller's references cannot be mutated into
  // the context afterwards), registered as a genuine capability.
  const owner: LedgerOwner = Object.freeze(
    params.owner.kind === "tenant" ? { kind: "tenant" as const, tenantId: params.owner.tenantId } : { kind: "platform" as const },
  );
  const ctx: TrustedLedgerContext = Object.freeze({ [TRUSTED]: true as const, owner, actorId: params.actorId, operation: params.operation });
  REGISTRY.add(ctx);
  return ctx;
}

/** True ONLY for a genuine context this module minted (WeakSet provenance) — a
 *  forged, spread, cloned, or brand-copied object is rejected. */
export function isTrustedLedgerContext(value: unknown): value is TrustedLedgerContext {
  return typeof value === "object" && value !== null && REGISTRY.has(value);
}

// ============================ Typed posting input ============================
export interface LedgerLegInput {
  readonly accountId: string;
  /** Signed micros; validated non-zero and within ±1e15 before posting. */
  readonly amountMicros: Micros;
}

/**
 * Financial data for a post. It carries NO owner/actor/operation — those come
 * from the TrustedLedgerContext, so a caller cannot assert its own authority
 * through this object.
 */
export interface LedgerPostInput {
  readonly currency: Currency;
  readonly effectiveAt: Date;
  readonly idempotencyKey: string;
  readonly legs: readonly LedgerLegInput[];
  readonly correlationId?: string | null;
  readonly sourceType?: string | null;
  readonly sourceRef?: string | null;
  readonly reversalOfId?: string | null;
}

function assertInputShape(input: LedgerPostInput): void {
  if (!input.idempotencyKey || typeof input.idempotencyKey !== "string") {
    throw new LedgerError("INVALID_LEDGER_STRUCTURE", "idempotencyKey is required");
  }
  if (!(input.effectiveAt instanceof Date) || Number.isNaN(input.effectiveAt.getTime())) {
    throw new LedgerError("INVALID_LEDGER_STRUCTURE", "effectiveAt must be a valid Date");
  }
  if (!Array.isArray(input.legs) || input.legs.length < 2) {
    throw new LedgerError("INVALID_LEDGER_STRUCTURE", "at least two legs are required");
  }
  if (input.reversalOfId != null) assertUuid(input.reversalOfId, "reversalOfId");
  for (const leg of input.legs) {
    assertUuid(leg.accountId, "leg.accountId");
    try {
      assertValidLegAmount(leg.amountMicros); // non-zero + within ±1e15
    } catch (e) {
      if (e instanceof MoneyError) throw new LedgerError("INVALID_MONEY_INPUT", "invalid ledger leg amount");
      throw e;
    }
  }
}

// ============================ Canonical fingerprint ==========================
// Canonical form (fingerprint v1): a JSON object built in a FIXED key order,
// amounts as canonical DECIMAL strings, and legs sorted by (accountId, amount)
// so leg INPUT order is insignificant (a double-entry transaction is an unordered
// balanced set — ledger_post sums legs order-independently). SHA-256 hex digest.
function canonicalForm(ctx: TrustedLedgerContext, input: LedgerPostInput, version: number): string {
  const legs = input.legs
    .map((l) => ({ accountId: l.accountId, amount: formatMicrosToDecimal(l.amountMicros) }))
    .sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0));
  // Fixed insertion order → deterministic JSON.stringify (no object-order variance).
  const canonical = {
    v: version,
    operation: ctx.operation,
    owner: ctx.owner.kind === "tenant" ? ctx.owner.tenantId : "@platform",
    actorId: ctx.actorId ?? null,
    currency: input.currency,
    effectiveAt: input.effectiveAt.toISOString(),
    correlationId: input.correlationId ?? null,
    sourceType: input.sourceType ?? null,
    sourceRef: input.sourceRef ?? null,
    reversalOfId: input.reversalOfId ?? null,
    legs,
  };
  return JSON.stringify(canonical);
}

/** Deterministic canonical fingerprint over all financially-significant fields. */
export function computeFingerprint(ctx: TrustedLedgerContext, input: LedgerPostInput, version: number = FINGERPRINT_VERSION): string {
  return sha256(canonicalForm(ctx, input, version));
}

// ============================ DB payload assembly ============================
/** The exact jsonb payload for billing.ledger_post, built from validated values.
 *  amountMicros is an exact integer-micros STRING (never a BigInt/number). */
export interface LedgerPostPayload {
  operation: string;
  ownerTenantId: string | null;
  currency: Currency;
  effectiveAt: string;
  correlationId: string | null;
  sourceType: string | null;
  sourceRef: string | null;
  actorId: string | null;
  reversalOfId: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  fingerprintVersion: number;
  legs: Array<{ accountId: string; amountMicros: string }>;
}

/** Validate + assemble the DB payload and its fingerprint from the trusted
 *  context and typed input. Throws a typed LedgerError on any invalid value. */
export function buildLedgerPostPayload(
  ctx: TrustedLedgerContext,
  input: LedgerPostInput,
  version: number = FINGERPRINT_VERSION,
): LedgerPostPayload {
  assertInputShape(input);
  const requestFingerprint = computeFingerprint(ctx, input, version);
  return {
    operation: ctx.operation,
    ownerTenantId: ctx.owner.kind === "tenant" ? ctx.owner.tenantId : null,
    currency: input.currency,
    effectiveAt: input.effectiveAt.toISOString(),
    correlationId: input.correlationId ?? null,
    sourceType: input.sourceType ?? null,
    sourceRef: input.sourceRef ?? null,
    actorId: ctx.actorId,
    reversalOfId: input.reversalOfId ?? null,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    fingerprintVersion: version,
    legs: input.legs.map((l) => ({ accountId: l.accountId, amountMicros: serializeMicros(l.amountMicros) })),
  };
}
