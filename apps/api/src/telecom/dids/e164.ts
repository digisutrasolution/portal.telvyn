import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * E.164 normalization (Phase 12G) via the vetted `libphonenumber-js`.
 * FORMAT VALIDITY != CARRIER VALIDITY — a number that normalizes is a
 * well-formed E.164 string, not a confirmation that a carrier serves it.
 *
 * Accepts a raw input (with spaces/dashes/parentheses) and returns the
 * canonical E.164 string + ISO-3166-1 alpha-2 country, or an error reason.
 */
export interface NormalizedNumber {
  e164: string; // canonical, e.g. "+919876543210"
  country: string; // ISO2, e.g. "IN"
}

export function normalizeE164(raw: string): { ok: true; value: NormalizedNumber } | { ok: false; reason: string } {
  if (typeof raw !== "string" || raw.trim().length === 0) return { ok: false, reason: "number is required" };
  // Require an explicit international prefix so the country is unambiguous.
  if (!raw.trim().startsWith("+")) return { ok: false, reason: "number must be in international format starting with +" };

  const parsed = parsePhoneNumberFromString(raw.trim());
  if (!parsed) return { ok: false, reason: "number could not be parsed" };
  if (!parsed.isValid()) return { ok: false, reason: "number is not a valid phone number" };

  const e164 = parsed.number; // canonical E.164
  const country = parsed.country;
  if (!country) return { ok: false, reason: "country could not be determined from the number" };
  // Defensive: E.164 max length is 15 digits (+ leading '+').
  if (e164.length > 16) return { ok: false, reason: "number exceeds E.164 length" };

  return { ok: true, value: { e164, country } };
}
