import type { EngineConfigurationIntent } from "../engine.types";

/**
 * Pure Kamailio htable config model (Phase 12N-4b, ADR-0013). Translates a
 * secret-free desired intent into bounded, validated key/value entries for ONE
 * dedicated htable, and computes a deterministic, idempotent diff against the
 * engine's current entries. No I/O here — the connector sends the operations.
 *
 * Safety invariants enforced here (not trusted to the engine):
 *  - Only the dedicated `telvyn` htable is ever named (constant below).
 *  - Keys are namespaced (`did:`/`trunk:`/`route:`) and never numeric, so Kamailio
 *    never reinterprets them as integer indices.
 *  - Keys/values are length-bounded and reject control chars / CRLF.
 *  - Values derive ONLY from safe fields (ids, validated E.164, enum, int) — never
 *    tenant free-text — so nothing injectable reaches the engine.
 *  - A bounded entry count; a malformed desired set is rejected whole (never a
 *    partial/sanitized push).
 */

export const TELVYN_HTABLE = "telvyn";
export const MANAGED_PREFIXES = ["did:", "trunk:", "route:"] as const;
export const MAX_ENTRIES = 2000;
const MAX_KEY_LEN = 96;
const MAX_VALUE_LEN = 128;

export interface HtableEntry {
  key: string;
  value: string;
}

export interface HtableDiff {
  sets: HtableEntry[];
  deletes: string[];
}

const hasControlChars = (v: string): boolean => {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
};

const isManagedKey = (k: string): boolean => MANAGED_PREFIXES.some((p) => k.startsWith(p));

/** A key must be a managed namespace + safe, non-numeric token. */
export function isSafeKey(k: string): boolean {
  if (typeof k !== "string" || k.length === 0 || k.length > MAX_KEY_LEN) return false;
  if (hasControlChars(k)) return false;
  return /^(did|trunk|route):[A-Za-z0-9+._:-]{1,80}$/.test(k);
}

export function isSafeValue(v: string): boolean {
  return typeof v === "string" && v.length <= MAX_VALUE_LEN && !hasControlChars(v);
}

const isE164 = (v: string): boolean => /^\+[1-9][0-9]{1,14}$/.test(v);
const isUuidish = (v: string): boolean => /^[0-9a-fA-F-]{8,40}$/.test(v);

/**
 * Build the desired, validated entry set from the intent. Returns an error
 * (and NO entries) if anything is malformed or over bounds — never a partial set.
 */
export function buildDesiredEntries(intent: EngineConfigurationIntent): { entries: HtableEntry[] } | { error: string } {
  const byKey = new Map<string, string>();
  const add = (key: string, value: string): string | null => {
    if (!isSafeKey(key)) return `invalid htable key: ${key.slice(0, 32)}`;
    if (!isSafeValue(value)) return `invalid htable value for ${key.slice(0, 32)}`;
    byKey.set(key, value);
    return null;
  };

  for (const t of intent.trunks) {
    if (!isUuidish(t.id)) return { error: "malformed trunk id" };
    const e = add(`trunk:${t.id}`, String(t.transport).slice(0, 16));
    if (e) return { error: e };
  }
  for (const d of intent.dids) {
    if (!isE164(d.e164)) return { error: `malformed DID e164: ${d.e164.slice(0, 20)}` };
    const e = add(`did:${d.e164}`, d.sipTrunkId && isUuidish(d.sipTrunkId) ? d.sipTrunkId : "");
    if (e) return { error: e };
  }
  for (const r of intent.routes) {
    if (!isUuidish(r.id)) return { error: "malformed route id" };
    const dt = String(r.destinationType).slice(0, 24);
    if (hasControlChars(dt) || !/^[A-Z_]+$/.test(dt)) return { error: "malformed route destinationType" };
    const e = add(`route:${r.id}`, `${dt}:${Math.trunc(r.priority)}`);
    if (e) return { error: e };
  }

  if (byKey.size > MAX_ENTRIES) return { error: `desired entry count ${byKey.size} exceeds limit ${MAX_ENTRIES}` };

  const entries = [...byKey.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { entries };
}

/**
 * Deterministic, idempotent diff: what to SET (new or changed) and DELETE (stale,
 * managed keys only — foreign keys in the table are never touched). `current` is
 * the live table's entries (managed keys). Equal desired/current → empty diff.
 */
export function diffEntries(desired: HtableEntry[], current: Map<string, string>): HtableDiff {
  const desiredMap = new Map(desired.map((e) => [e.key, e.value]));
  const sets: HtableEntry[] = [];
  for (const e of desired) {
    if (current.get(e.key) !== e.value) sets.push(e);
  }
  const deletes: string[] = [];
  for (const key of current.keys()) {
    if (isManagedKey(key) && !desiredMap.has(key)) deletes.push(key);
  }
  sets.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  deletes.sort();
  return { sets, deletes };
}

/**
 * Defensively extract MANAGED key/value pairs from an htable.dump JSON-RPC result
 * (the documented nesting is entry → slot → item{name,value}, but the exact shape
 * is not contract-guaranteed). Recursively collect every object exposing string
 * `name` + `value`; keep only our managed, safe keys. Foreign/unsafe keys are
 * ignored, never managed.
 */
export function parseDumpEntries(result: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    const o = node as Record<string, unknown>;
    if (typeof o.name === "string" && (typeof o.value === "string" || typeof o.value === "number")) {
      const key = o.name;
      if (isManagedKey(key) && isSafeKey(key)) {
        const value = String(o.value);
        if (isSafeValue(value)) out.set(key, value);
      }
    }
    for (const v of Object.values(o)) visit(v);
  };
  visit(result);
  return out;
}
