import { describe, it, expect } from "vitest";
import {
  MAX_MICROS,
  MIN_MICROS,
  MoneyError,
  addMicros,
  assertInMoneyBounds,
  assertValidLegAmount,
  compareMicros,
  formatMicrosToDecimal,
  microsFromBigInt,
  negateMicros,
  parseDecimalToMicros,
  parseMicrosString,
  serializeMicros,
  subMicros,
  sumMicros,
  type Micros,
} from "./money";

const m = (v: bigint): Micros => microsFromBigInt(v);

describe("money — parseDecimalToMicros (exact)", () => {
  it("parses zero, whole, negative, fractional, one-micro and six-digit amounts to exact micros", () => {
    expect(parseDecimalToMicros("0")).toBe(0n);
    expect(parseDecimalToMicros("5")).toBe(5_000_000n);
    expect(parseDecimalToMicros("-5")).toBe(-5_000_000n);
    expect(parseDecimalToMicros("1.25")).toBe(1_250_000n);
    expect(parseDecimalToMicros("0.000001")).toBe(1n);
    expect(parseDecimalToMicros("0.123456")).toBe(123_456n);
    expect(parseDecimalToMicros("-1.25")).toBe(-1_250_000n);
    expect(parseDecimalToMicros("10.5")).toBe(10_500_000n);
  });

  it("accepts the maximum positive and negative representable amounts", () => {
    expect(parseDecimalToMicros("1000000000")).toBe(MAX_MICROS);
    expect(parseDecimalToMicros("-1000000000")).toBe(MIN_MICROS);
  });

  it("normalizes negative zero to 0n", () => {
    expect(parseDecimalToMicros("-0")).toBe(0n);
    expect(parseDecimalToMicros("-0.000000")).toBe(0n);
  });

  it("tolerates leading integer zeros without rounding", () => {
    expect(parseDecimalToMicros("01.50")).toBe(1_500_000n);
  });

  it("rejects one micro above the maximum / below the minimum", () => {
    expect(() => parseDecimalToMicros("1000000000.000001")).toThrow(MoneyError);
    expect(() => parseDecimalToMicros("-1000000000.000001")).toThrow(MoneyError);
  });

  it("rejects malformed grammar, scientific/hex notation, separators and whitespace", () => {
    for (const bad of ["", "abc", "1.2.3", "1,5", "1 000", " 1", "1 ", "1e3", "1E3", "0x10", ".5", "5.", "+-1", "1.", "--1"]) {
      expect(() => parseDecimalToMicros(bad), bad).toThrow(MoneyError);
    }
  });

  it("rejects more than six fractional digits (never silently truncates)", () => {
    expect(() => parseDecimalToMicros("0.1234567")).toThrow(MoneyError);
    expect(() => parseDecimalToMicros("1.0000001")).toThrow(MoneyError);
  });

  it("rejects NaN / Infinity / non-string / oversized input", () => {
    expect(() => parseDecimalToMicros("NaN")).toThrow(MoneyError);
    expect(() => parseDecimalToMicros("Infinity")).toThrow(MoneyError);
    // non-string (e.g. a JS number) is rejected
    expect(() => parseDecimalToMicros(5 as unknown as string)).toThrow(MoneyError);
    expect(() => parseDecimalToMicros("1".repeat(40))).toThrow(MoneyError);
  });
});

describe("money — formatMicrosToDecimal + round-trip", () => {
  it("formats canonically, trimming trailing fractional zeros", () => {
    expect(formatMicrosToDecimal(m(1_000_000n))).toBe("1");
    expect(formatMicrosToDecimal(m(1_250_000n))).toBe("1.25");
    expect(formatMicrosToDecimal(m(1n))).toBe("0.000001");
    expect(formatMicrosToDecimal(m(-1_250_000n))).toBe("-1.25");
    expect(formatMicrosToDecimal(m(0n))).toBe("0");
    expect(formatMicrosToDecimal(MAX_MICROS as Micros)).toBe("1000000000");
  });

  it("never emits a negative zero", () => {
    expect(formatMicrosToDecimal(m(0n))).not.toContain("-");
  });

  it("round-trips decimal <-> micros exactly", () => {
    for (const s of ["0", "1", "1.25", "0.000001", "-1.25", "1000000000", "-1000000000", "999.999999"]) {
      expect(formatMicrosToDecimal(parseDecimalToMicros(s))).toBe(s);
    }
    for (const v of [0n, 1n, -1n, 1_250_000n, MAX_MICROS, MIN_MICROS]) {
      expect(parseDecimalToMicros(formatMicrosToDecimal(m(v)))).toBe(v);
    }
  });
});

describe("money — micros string serialization", () => {
  it("serializes to an exact integer string and parses it back", () => {
    expect(serializeMicros(m(1_250_000n))).toBe("1250000");
    expect(serializeMicros(m(-1n))).toBe("-1");
    expect(parseMicrosString("1250000")).toBe(1_250_000n);
    expect(parseMicrosString("-1")).toBe(-1n);
  });
  it("rejects non-integer / out-of-range micros strings", () => {
    for (const bad of ["1.5", "1e6", "", "abc", "1000000000000001"]) {
      expect(() => parseMicrosString(bad), bad).toThrow(MoneyError);
    }
  });
});

describe("money — bounds + MIN-BIGINT", () => {
  it("accepts zero as a general money amount but rejects it as a ledger leg", () => {
    expect(() => assertInMoneyBounds(m(0n))).not.toThrow();
    expect(() => assertValidLegAmount(m(0n))).toThrow(MoneyError);
  });
  it("rejects MIN-BIGINT (−2^63) as out of range", () => {
    expect(() => microsFromBigInt(-9_223_372_036_854_775_808n)).toThrow(MoneyError);
  });
  it("rejects amounts outside ±1e15", () => {
    expect(() => microsFromBigInt(MAX_MICROS + 1n)).toThrow(MoneyError);
    expect(() => microsFromBigInt(MIN_MICROS - 1n)).toThrow(MoneyError);
  });
});

describe("money — exact arithmetic", () => {
  it("adds, subtracts, negates and compares exactly", () => {
    expect(addMicros(m(1_000_000n), m(250_000n))).toBe(1_250_000n);
    expect(subMicros(m(1_000_000n), m(250_000n))).toBe(750_000n);
    expect(negateMicros(m(1_250_000n))).toBe(-1_250_000n);
    expect(negateMicros(MAX_MICROS as Micros)).toBe(MIN_MICROS);
    expect(compareMicros(m(1n), m(2n))).toBe(-1);
    expect(compareMicros(m(2n), m(2n))).toBe(0);
    expect(compareMicros(m(3n), m(2n))).toBe(1);
  });
  it("sums exactly BEYOND the per-leg bound (aggregate contract) without overflow", () => {
    const legs = [MAX_MICROS, MAX_MICROS, MAX_MICROS].map((v) => m(v));
    expect(sumMicros(legs)).toBe(3_000_000_000_000_000n); // > per-leg bound, exact
  });
  it("a balanced leg set sums to exactly zero", () => {
    expect(sumMicros([m(1_000_000n), m(-400_000n), m(-600_000n)])).toBe(0n);
  });
});
