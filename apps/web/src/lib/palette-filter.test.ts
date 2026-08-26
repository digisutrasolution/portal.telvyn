import { describe, expect, it } from "vitest";
import { paletteMatch } from "./palette-filter";

describe("paletteMatch (E.164-aware)", () => {
  it("matches numbers regardless of formatting", () => {
    expect(paletteMatch("+1 415 555 0142", "4155550142")).toBe(1);
    expect(paletteMatch("+1 415 555 0142", "+1 415")).toBe(1);
    expect(paletteMatch("+1 415 555 0142", "415-555")).toBe(1);
  });

  it("rejects non-matching digit sequences", () => {
    expect(paletteMatch("+1 415 555 0142", "999")).toBe(0);
  });

  it("falls back to case-insensitive text matching", () => {
    expect(paletteMatch("go Numbers", "numb")).toBe(1);
    expect(paletteMatch("go Billing", "cdr")).toBe(0);
  });

  it("matches everything on an empty query", () => {
    expect(paletteMatch("anything", "  ")).toBe(1);
  });
});
