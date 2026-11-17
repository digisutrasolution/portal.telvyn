/**
 * Phase 12N-4b — pure htable config model (validation, deterministic diff,
 * defensive dump parsing). No I/O.
 */
import { describe, expect, it } from "vitest";
import { TelecomEngineType } from "@prisma/client";
import { buildDesiredEntries, diffEntries, parseDumpEntries, isSafeKey, isSafeValue, MAX_ENTRIES, type HtableEntry } from "./htable-config";
import type { EngineConfigurationIntent } from "../engine.types";

const intent = (over: Partial<EngineConfigurationIntent> = {}): EngineConfigurationIntent => ({
  engineType: TelecomEngineType.KAMAILIO,
  carriers: [],
  trunks: [],
  dids: [],
  routes: [],
  ...over,
});

const TRUNK = "01a1e724-0000-7000-8000-000000000001";
const PROFILE = "01a1e724-0000-7000-8000-000000000002";

describe("buildDesiredEntries", () => {
  it("maps trunks/DIDs/routes to safe, sorted entries", () => {
    const r = buildDesiredEntries(
      intent({
        trunks: [{ id: TRUNK, name: "t", host: "h", transport: "UDP", credentialRef: null }],
        dids: [{ id: "d1", e164: "+14155550100", carrierId: null, sipTrunkId: TRUNK }],
        routes: [{ id: PROFILE, destinationType: "EXTENSION", priority: 100 }],
      }),
    );
    expect("entries" in r).toBe(true);
    if (!("entries" in r)) return;
    const byKey = Object.fromEntries(r.entries.map((e) => [e.key, e.value]));
    expect(byKey[`trunk:${TRUNK}`]).toBe("UDP");
    expect(byKey["did:+14155550100"]).toBe(TRUNK);
    expect(byKey[`route:${PROFILE}`]).toBe("EXTENSION:100");
    // deterministic order
    expect(r.entries.map((e) => e.key)).toEqual([...r.entries.map((e) => e.key)].sort());
  });

  it("rejects a malformed E.164, bad destinationType, and over-limit sets (whole, never partial)", () => {
    expect("error" in buildDesiredEntries(intent({ dids: [{ id: "d", e164: "notaphone", carrierId: null, sipTrunkId: null }] }))).toBe(true);
    expect("error" in buildDesiredEntries(intent({ routes: [{ id: PROFILE, destinationType: "bad type;drop", priority: 1 }] }))).toBe(true);
    const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({ id: `${PROFILE.slice(0, 30)}${i}`, destinationType: "EXTENSION", priority: i }));
    expect("error" in buildDesiredEntries(intent({ routes: many }))).toBe(true);
  });
});

describe("isSafeKey / isSafeValue", () => {
  it("accepts managed namespaced keys, rejects foreign/numeric/control", () => {
    expect(isSafeKey("did:+14155550100")).toBe(true);
    expect(isSafeKey(`trunk:${TRUNK}`)).toBe(true);
    expect(isSafeKey("1000")).toBe(false); // numeric, not namespaced
    expect(isSafeKey("foreign:x")).toBe(false);
    expect(isSafeKey("did:\r\n")).toBe(false);
  });
  it("bounds values and rejects control chars", () => {
    expect(isSafeValue("UDP")).toBe(true);
    expect(isSafeValue("a\nb")).toBe(false);
    expect(isSafeValue("x".repeat(200))).toBe(false);
  });
});

describe("diffEntries — deterministic + idempotent + isolation", () => {
  const desired: HtableEntry[] = [
    { key: "did:+14155550100", value: "t1" },
    { key: `trunk:${TRUNK}`, value: "UDP" },
  ];
  it("sets new/changed, deletes stale MANAGED keys, leaves foreign keys", () => {
    const current = new Map([
      ["did:+14155550100", "OLD"], // changed → set
      ["route:stale", "x"], // stale managed → delete
      ["foreign:keep", "y"], // foreign → never touched
    ]);
    const d = diffEntries(desired, current);
    expect(d.sets.map((s) => s.key).sort()).toEqual(["did:+14155550100", `trunk:${TRUNK}`]);
    expect(d.deletes).toEqual(["route:stale"]);
    expect(d.deletes).not.toContain("foreign:keep");
  });
  it("is a 0-op NOOP when current already equals desired (idempotent)", () => {
    const current = new Map(desired.map((e) => [e.key, e.value]));
    const d = diffEntries(desired, current);
    expect(d.sets).toEqual([]);
    expect(d.deletes).toEqual([]);
  });
});

describe("parseDumpEntries — defensive, managed-only", () => {
  it("extracts managed name/value from nested dump, ignoring foreign/unsafe", () => {
    const dump = {
      result: [
        { entry: 0, size: 1, slot: [{ item: { name: "did:+14155550100", value: "t1" } }] },
        { entry: 1, size: 1, slot: [{ item: { name: "foreign:x", value: "nope" } }] },
        { entry: 2, size: 1, slot: [{ item: { name: `trunk:${TRUNK}`, value: "UDP" } }] },
      ],
    };
    const m = parseDumpEntries(dump);
    expect(m.get("did:+14155550100")).toBe("t1");
    expect(m.get(`trunk:${TRUNK}`)).toBe("UDP");
    expect(m.has("foreign:x")).toBe(false); // foreign keys never managed
  });
  it("returns empty for empty/garbage input", () => {
    expect(parseDumpEntries(null).size).toBe(0);
    expect(parseDumpEntries({ result: [] }).size).toBe(0);
    expect(parseDumpEntries("oops").size).toBe(0);
  });
});
