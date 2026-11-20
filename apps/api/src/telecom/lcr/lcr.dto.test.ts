import { describe, expect, it } from "vitest";
import { ListLcrPoliciesQuery } from "./lcr.dto";

/**
 * Query-string booleans arrive as strings. The list filter must honour
 * `enabled=false` — the previous `z.coerce.boolean()` (`Boolean("false")` ===
 * true) silently inverted it into `enabled=true`. These guard that correctness.
 */
describe("ListLcrPoliciesQuery.enabled coercion", () => {
  it("parses the string \"true\" to boolean true", () => {
    expect(ListLcrPoliciesQuery.parse({ enabled: "true" }).enabled).toBe(true);
  });

  it("parses the string \"false\" to boolean false (not true)", () => {
    expect(ListLcrPoliciesQuery.parse({ enabled: "false" }).enabled).toBe(false);
  });

  it("leaves enabled undefined (no filter) when the param is absent", () => {
    expect(ListLcrPoliciesQuery.parse({}).enabled).toBeUndefined();
  });

  it("passes through a real boolean for direct callers", () => {
    expect(ListLcrPoliciesQuery.parse({ enabled: true }).enabled).toBe(true);
    expect(ListLcrPoliciesQuery.parse({ enabled: false }).enabled).toBe(false);
  });

  it("rejects a non-boolean-ish value (400 at the boundary)", () => {
    expect(() => ListLcrPoliciesQuery.parse({ enabled: "maybe" })).toThrow();
  });
});
