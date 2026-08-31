import { describe, expect, it } from "vitest";
import { LcrSelectionStrategy, type LcrRoute } from "@prisma/client";
import { orderCandidates } from "./lcr.service";

const r = (id: string, costMicros: number, priority: number, weight?: number): LcrRoute =>
  ({ id, costMicros: BigInt(costMicros), priority, weight: weight ?? null }) as unknown as LcrRoute;

describe("LCR deterministic candidate ordering", () => {
  it("LOWEST_COST orders by cost, then priority, then id", () => {
    const routes = [r("c", 300, 10), r("a", 100, 10), r("b", 200, 10)];
    expect(orderCandidates(routes, LcrSelectionStrategy.LOWEST_COST).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("HIGHEST_PRIORITY orders by priority (lower first), then cost", () => {
    const routes = [r("x", 100, 30), r("y", 100, 10), r("z", 100, 20)];
    expect(orderCandidates(routes, LcrSelectionStrategy.HIGHEST_PRIORITY).map((x) => x.id)).toEqual(["y", "z", "x"]);
  });

  it("WEIGHTED orders by weight (higher first)", () => {
    const routes = [r("x", 100, 10, 10), r("y", 100, 10, 30), r("z", 100, 10, 20)];
    expect(orderCandidates(routes, LcrSelectionStrategy.WEIGHTED).map((x) => x.id)).toEqual(["y", "z", "x"]);
  });

  it("breaks every tie deterministically by id (never insertion order)", () => {
    const routes = [r("b2", 100, 10), r("a1", 100, 10)];
    expect(orderCandidates(routes, LcrSelectionStrategy.LOWEST_COST).map((x) => x.id)).toEqual(["a1", "b2"]);
    // Same input reversed → same deterministic output.
    expect(orderCandidates([...routes].reverse(), LcrSelectionStrategy.LOWEST_COST).map((x) => x.id)).toEqual(["a1", "b2"]);
  });

  it("QUALITY_FIRST falls back deterministically (no health subsystem yet)", () => {
    const routes = [r("x", 200, 20), r("y", 100, 10)];
    expect(orderCandidates(routes, LcrSelectionStrategy.QUALITY_FIRST).map((x) => x.id)).toEqual(["y", "x"]);
  });
});
