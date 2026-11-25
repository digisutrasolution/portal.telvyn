/**
 * Exact money utility (Phase 13-1D). Pure, dependency-free, deterministic.
 *
 * Canonical representation: **signed integer micros** as a `bigint`. One currency
 * unit = 1,000,000 micros. NEVER a JavaScript `number` for monetary values —
 * `number` loses precision past 2^53 and cannot represent exact decimals.
 * No `parseFloat`/`parseInt`/`Number()`/`toFixed`/`Math.round`/float * or / is
 * used anywhere in this module.
 *
 * Bounds (LEDGER_FOUNDATION §11 / R5; migration CHECK ±1e15):
 *   - A ledger-leg amount is a NON-ZERO integer in [-1e15, +1e15] micros
 *     (= ±1e9 currency units). The ±1e15 bound also keeps reversal negation
 *     representable and rejects MIN-BIGINT (−2^63, whose negation overflows).
 *   - A general money amount may be ZERO; it is still bounded to ±1e15 (the
 *     maximum value a single parsed decimal may represent).
 *   - AGGREGATE sums (e.g. a balance) are NOT per-leg bounded — they use exact
 *     `bigint` arithmetic and never overflow (unlike the database BIGINT column,
 *     which is why the ledger aggregates in NUMERIC on the SQL side).
 */

declare const MicrosBrand: unique symbol;
/** Branded signed integer micros. Construct only via this module's functions. */
export type Micros = bigint & { readonly [MicrosBrand]: never };

export const MICROS_PER_UNIT = 1_000_000n;
/** Inclusive per-amount bound: ±1e15 micros (= ±1e9 units). Matches the DB CHECK. */
export const MAX_MICROS = 1_000_000_000_000_000n;
export const MIN_MICROS = -1_000_000_000_000_000n;
/** Max fractional digits a decimal string may carry (6 = micro precision). */
export const MICRO_SCALE = 6;
/** Hard cap on decimal-string input length (before BigInt work). 1e9 units + sign
 *  + '.' + 6 fractional digits is ~18 chars; 32 is a safe, generous ceiling. */
const MAX_DECIMAL_INPUT_LENGTH = 32;

/** Thrown for any invalid monetary input or operation. Caught + re-mapped by the
 *  ledger error layer; never carries SQL, credentials, or internal metadata. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

function brand(value: bigint): Micros {
  return value as Micros;
}

// Strict decimal grammar: optional single leading sign, one-or-more integer
// digits (leading zeros tolerated on input; canonicalized away on output), an
// OPTIONAL fractional part of 1..6 digits. No exponent, hex, whitespace,
// thousands separators, NaN/Infinity, or empty string. (Documented conservative
// choice — LEDGER_FOUNDATION specifies "decimal strings"; the exact grammar is
// pinned here, §8.)
const DECIMAL_RE = /^(?<sign>[+-]?)(?<int>\d+)(?:\.(?<frac>\d{1,6}))?$/;

/**
 * Exact decimal string → micros. Rejects everything outside the grammar above
 * and anything outside ±1e15. Never rounds or truncates silently.
 */
export function parseDecimalToMicros(input: string): Micros {
  if (typeof input !== "string") {
    throw new MoneyError("monetary amount must be a decimal string, not a number or other type");
  }
  if (input.length === 0) throw new MoneyError("empty monetary amount");
  if (input.length > MAX_DECIMAL_INPUT_LENGTH) throw new MoneyError("monetary amount string too long");
  const m = DECIMAL_RE.exec(input);
  if (!m || !m.groups) throw new MoneyError(`malformed monetary amount: ${JSON.stringify(input)}`);

  const negative = m.groups.sign === "-";
  const intPart = m.groups.int;
  const fracPart = (m.groups.frac ?? "").padEnd(MICRO_SCALE, "0"); // right-pad to exactly 6

  const magnitude = BigInt(intPart) * MICROS_PER_UNIT + BigInt(fracPart);
  let micros = negative ? -magnitude : magnitude;
  if (micros === 0n) micros = 0n; // normalize negative zero

  assertInMoneyBounds(brand(micros));
  return brand(micros);
}

/**
 * Micros → canonical decimal string. Trailing fractional zeros are trimmed; a
 * whole amount has no fractional part. Round-trips with parseDecimalToMicros.
 * Examples: 1000000n→"1", 1250000n→"1.25", 1n→"0.000001", -1250000n→"-1.25".
 */
export function formatMicrosToDecimal(micros: Micros): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const whole = abs / MICROS_PER_UNIT;
  const frac = abs % MICROS_PER_UNIT;
  const sign = neg ? "-" : "";
  if (frac === 0n) return `${sign}${whole.toString()}`;
  const fracStr = frac.toString().padStart(MICRO_SCALE, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}.${fracStr}`;
}

/** Micros → exact integer-micros string (for JSON; never a BigInt or number). */
export function serializeMicros(micros: Micros): string {
  return micros.toString();
}

/** Exact integer-micros string → micros. Rejects non-integer / out-of-range. */
export function parseMicrosString(input: string): Micros {
  if (typeof input !== "string" || !/^-?\d+$/.test(input)) {
    throw new MoneyError(`malformed micros integer string: ${JSON.stringify(input)}`);
  }
  if (input.length > MAX_DECIMAL_INPUT_LENGTH) throw new MoneyError("micros string too long");
  const micros = brand(BigInt(input));
  assertInMoneyBounds(micros);
  return micros;
}

/** Wrap a raw bigint as Micros, enforcing the ±1e15 money bound (zero allowed). */
export function microsFromBigInt(value: bigint): Micros {
  if (typeof value !== "bigint") throw new MoneyError("micros must be a bigint");
  const micros = brand(value);
  assertInMoneyBounds(micros);
  return micros;
}

/** General money bound: within ±1e15 (zero allowed). */
export function assertInMoneyBounds(micros: Micros): void {
  if (micros < MIN_MICROS || micros > MAX_MICROS) {
    throw new MoneyError("monetary amount out of range (|amount| > 1e15 micros)");
  }
}

/** Ledger-leg bound: non-zero AND within ±1e15. Zero is invalid for a leg. */
export function assertValidLegAmount(micros: Micros): void {
  assertInMoneyBounds(micros);
  if (micros === 0n) throw new MoneyError("a ledger leg amount must be non-zero");
}

// ---- exact arithmetic (bigint only) --------------------------------------
/** Exact addition; the result is bound-checked as a money amount. */
export function addMicros(a: Micros, b: Micros): Micros {
  return microsFromBigInt(a + b);
}
/** Exact subtraction; the result is bound-checked as a money amount. */
export function subMicros(a: Micros, b: Micros): Micros {
  return microsFromBigInt(a - b);
}
/** Safe negation; the ±1e15 bound guarantees representability (rejects MIN-BIGINT). */
export function negateMicros(a: Micros): Micros {
  return microsFromBigInt(-a);
}
/** Exact comparison: -1 | 0 | 1. */
export function compareMicros(a: Micros, b: Micros): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}
/**
 * Exact sum of micros values. Aggregates are NOT per-leg bounded (a balance may
 * exceed ±1e15) — exact bigint, no overflow. Each INPUT must still be a valid
 * money amount; the SUM is returned as a raw bigint, not a bounded Micros.
 */
export function sumMicros(values: readonly Micros[]): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}
