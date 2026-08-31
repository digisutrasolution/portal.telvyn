import { describe, expect, it } from "vitest";
import { normalizeE164 } from "./e164";

describe("E.164 normalization", () => {
  it("normalizes equivalent formats of the same number to one canonical value", () => {
    const forms = ["+919876543210", "+91 98765 43210", "+91-98765-43210", "+91 (98765) 43210"];
    const results = forms.map((f) => normalizeE164(f));
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.e164).toBe("+919876543210");
        expect(r.value.country).toBe("IN");
      }
    }
  });

  it("derives country from the number (not the caller)", () => {
    const uk = normalizeE164("+44 20 7183 8750");
    expect(uk.ok).toBe(true);
    if (uk.ok) {
      expect(uk.value.e164).toBe("+442071838750");
      expect(uk.value.country).toBe("GB");
    }
  });

  it("rejects malformed / impossible numbers", () => {
    for (const bad of ["hello", "919876543210", "+91 98765", "+1234567890123456789", "", "   ", "+"]) {
      expect(normalizeE164(bad).ok).toBe(false);
    }
  });
});
