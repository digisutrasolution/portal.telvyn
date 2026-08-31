import { createHash } from "node:crypto";
import type { EngineConfigurationIntent } from "../engine.types";

/**
 * Deterministic, secret-free fingerprinting of an engine configuration intent
 * (Phase 12L). The fingerprint IS the desired configuration version: identical
 * control-plane state → identical fingerprint (idempotency), any change → a new
 * one. Pure — no I/O. Carries only id references + non-secret config (the intent
 * already excludes secrets: credentials are `credentialRef` ids).
 */

/** Stable canonical JSON: object keys sorted recursively, arrays order-normalized by `id`. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) {
    const mapped = v.map(sortValue);
    // Order-independent for id-bearing records so array reordering is not a change.
    return [...mapped].sort((a, b) => canonicalKey(a).localeCompare(canonicalKey(b)));
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

function canonicalKey(v: unknown): string {
  if (v && typeof v === "object" && "id" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>).id);
  }
  return JSON.stringify(v);
}

/** SHA-256 fingerprint of the canonicalized intent. */
export function fingerprintIntent(intent: EngineConfigurationIntent): string {
  return createHash("sha256").update(canonicalize(intent)).digest("hex");
}

/** Short, log-friendly form of a fingerprint (first 12 hex chars). */
export function shortFingerprint(fp: string): string {
  return fp.slice(0, 12);
}
