/**
 * Stable internal financial error contract (Phase 13-1D, §22).
 *
 * Maps raw database failures (ledger SQLSTATEs LG001..LG033, plus 23xxx / 42501 /
 * 40001 / 40P01) and application-side money/validation failures to a typed,
 * discriminated hierarchy. These are INTERNAL errors — they carry no SQL,
 * credentials, parameters, or internal metadata, and they are NOT HttpExceptions
 * (no public HTTP semantics are introduced here). A future authorized caller
 * decides how, if at all, to surface them.
 */
import { MoneyError } from "./money";

export type LedgerErrorKind =
  | "INVALID_MONEY_INPUT" // app-side money/amount/serialization validation
  | "INVALID_LEDGER_STRUCTURE" // <2 legs / unbalanced
  | "CURRENCY_MISMATCH"
  | "OWNERSHIP_MISMATCH" // cross-tenant / invalid owner namespace
  | "MISSING_AUTHORIZATION_CONTEXT" // trusted context absent / owner≠context
  | "IDEMPOTENCY_CONFLICT" // same key, different payload
  | "DEFERRED_INVARIANT" // COMMIT-time invariant failure (incl. incomplete idempotency)
  | "IMMUTABLE_HISTORY" // attempt to mutate posted rows / account identity / completed key
  | "DATABASE_PRIVILEGE" // 42501
  | "CONCURRENCY" // 40001 / 40P01
  | "CONSTRAINT" // other 23xxx
  | "SERIALIZATION" // app-side (un)serialization failure
  | "UNKNOWN"; // never swallowed, never leaked verbatim

export class LedgerError extends Error {
  constructor(
    readonly kind: LedgerErrorKind,
    message: string,
    /** The originating PostgreSQL SQLSTATE where one was observed (diagnostic only). */
    readonly sqlstate?: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

// ---- SQLSTATE extraction from a Prisma raw-query failure -------------------
type MaybePrismaErr = {
  code?: string;
  meta?: { code?: string; message?: string };
  message?: string;
};

/** Immediate raw-query failures surface as Prisma P2010 with meta.code = SQLSTATE. */
function sqlstateOf(err: MaybePrismaErr): string | undefined {
  if (err && err.code === "P2010" && typeof err.meta?.code === "string") return err.meta.code;
  return undefined;
}

/** Deferred (COMMIT-time) failures surface as PrismaClientUnknownRequestError
 *  without meta.code — classify by the trigger's message text. */
function textOf(err: MaybePrismaErr): string {
  return (err?.meta?.message ?? err?.message ?? "").toString();
}

const SQLSTATE_KIND: Record<string, LedgerErrorKind> = {
  LG001: "INVALID_LEDGER_STRUCTURE",
  LG002: "INVALID_LEDGER_STRUCTURE",
  LG003: "CURRENCY_MISMATCH",
  LG004: "OWNERSHIP_MISMATCH",
  LG005: "DEFERRED_INVARIANT",
  LG010: "IMMUTABLE_HISTORY",
  LG011: "IMMUTABLE_HISTORY",
  LG012: "IMMUTABLE_HISTORY",
  LG020: "IDEMPOTENCY_CONFLICT",
  LG030: "MISSING_AUTHORIZATION_CONTEXT",
  LG031: "INVALID_LEDGER_STRUCTURE",
  LG032: "INVALID_MONEY_INPUT",
  LG033: "INVALID_LEDGER_STRUCTURE",
  "42501": "DATABASE_PRIVILEGE",
  "40001": "CONCURRENCY",
  "40P01": "CONCURRENCY",
  "23505": "CONSTRAINT",
  "23503": "CONSTRAINT",
  "23514": "CONSTRAINT",
};

const SAFE_MESSAGE: Record<LedgerErrorKind, string> = {
  INVALID_MONEY_INPUT: "invalid monetary amount",
  INVALID_LEDGER_STRUCTURE: "invalid ledger transaction structure",
  CURRENCY_MISMATCH: "currency mismatch in ledger transaction",
  OWNERSHIP_MISMATCH: "ledger ownership violation",
  MISSING_AUTHORIZATION_CONTEXT: "missing or inconsistent financial authorization context",
  IDEMPOTENCY_CONFLICT: "idempotency conflict: same key, different payload",
  DEFERRED_INVARIANT: "ledger invariant violated at commit",
  IMMUTABLE_HISTORY: "financial history is immutable",
  DATABASE_PRIVILEGE: "insufficient database privilege for ledger operation",
  CONCURRENCY: "ledger operation serialization/deadlock; retry safe with the same idempotency key",
  CONSTRAINT: "ledger constraint violation",
  SERIALIZATION: "ledger payload serialization failure",
  UNKNOWN: "unexpected ledger failure",
};

/**
 * Map any thrown value to a typed LedgerError. App-side Moneyerrors map to
 * INVALID_MONEY_INPUT; an already-typed LedgerError passes through; a Prisma raw
 * failure is classified by SQLSTATE (immediate) or trigger message (deferred);
 * anything else becomes UNKNOWN (logged by the caller, never surfaced verbatim).
 */
export function mapLedgerError(err: unknown): LedgerError {
  if (err instanceof LedgerError) return err;
  if (err instanceof MoneyError) {
    return new LedgerError("INVALID_MONEY_INPUT", SAFE_MESSAGE.INVALID_MONEY_INPUT);
  }
  const e = err as MaybePrismaErr;
  const code = sqlstateOf(e);
  if (code && SQLSTATE_KIND[code]) {
    const kind = SQLSTATE_KIND[code];
    return new LedgerError(kind, SAFE_MESSAGE[kind], code);
  }
  // Deferred COMMIT-time triggers (no meta.code): classify by message text.
  const text = textOf(e);
  if (/committed without a result transaction/i.test(text)) return new LedgerError("DEFERRED_INVARIANT", SAFE_MESSAGE.DEFERRED_INVARIANT);
  if (/fewer than two non-zero legs|unbalanced/i.test(text)) return new LedgerError("INVALID_LEDGER_STRUCTURE", SAFE_MESSAGE.INVALID_LEDGER_STRUCTURE);
  if (/mixes currencies/i.test(text)) return new LedgerError("CURRENCY_MISMATCH", SAFE_MESSAGE.CURRENCY_MISMATCH);
  if (/crosses tenant ownership/i.test(text)) return new LedgerError("OWNERSHIP_MISMATCH", SAFE_MESSAGE.OWNERSHIP_MISMATCH);
  if (/is immutable|cannot be deleted|cannot add a leg/i.test(text)) return new LedgerError("IMMUTABLE_HISTORY", SAFE_MESSAGE.IMMUTABLE_HISTORY);
  // A bare LGxxx anywhere in the text (defensive).
  const lg = /\b(LG0\d{2})\b/.exec(text)?.[1];
  if (lg && SQLSTATE_KIND[lg]) {
    const kind = SQLSTATE_KIND[lg];
    return new LedgerError(kind, SAFE_MESSAGE[kind], lg);
  }
  return new LedgerError("UNKNOWN", SAFE_MESSAGE.UNKNOWN);
}
