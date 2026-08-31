import { TelecomEngineType } from "@prisma/client";

/**
 * Centralized, provider-neutral runtime connection profiles (Phase 12L). One
 * place defines HOW each engine's management plane is reached and the bounded
 * timeout/retry/backoff envelope for talking to it. Data only — no I/O, no
 * secrets, no commands. A connector reads these; it never invents its own.
 *
 * `mechanism` is descriptive metadata (which management interface a real adapter
 * would use); the foundation ships NO live connector, so these describe intent,
 * not active behavior.
 */

export interface ConnectionProfile {
  provider: TelecomEngineType;
  /** Human-readable management interface a real adapter would drive. */
  mechanism: string;
  /** Default management scheme (http/https) when an endpoint omits one. */
  defaultScheme: "http" | "https";
  /** Whether this engine can ORIGINATE calls (mirrors adapter capability). */
  canOriginate: boolean;
  /** Bounded network envelope — never infinite. */
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  /** Hard upper bound for a whole operation incl. retries. */
  maxOperationMs: number;
  maxRetries: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
}

const BASE = {
  defaultScheme: "https" as const,
  connectTimeoutMs: 3000,
  requestTimeoutMs: 5000,
  maxOperationMs: 20_000,
  maxRetries: 2,
  backoffBaseMs: 250,
  backoffMaxMs: 2000,
};

const PROFILES: Record<TelecomEngineType, ConnectionProfile> = {
  [TelecomEngineType.KAMAILIO]: {
    provider: TelecomEngineType.KAMAILIO,
    mechanism: "JSONRPC over HTTP (kamctl/jsonrpc) — signalling/router; no origination",
    canOriginate: false,
    ...BASE,
  },
  [TelecomEngineType.ASTERISK]: {
    provider: TelecomEngineType.ASTERISK,
    mechanism: "ARI (Asterisk REST Interface) over HTTP — typed operations only, never AMI raw commands",
    canOriginate: true,
    ...BASE,
  },
  [TelecomEngineType.FREESWITCH]: {
    provider: TelecomEngineType.FREESWITCH,
    mechanism: "mod_xml_rpc / HTTP management — typed operations only, never raw ESL",
    canOriginate: true,
    ...BASE,
  },
};

/** Resolve the connection profile for an engine type. Never throws for a known enum. */
export function connectionProfile(provider: TelecomEngineType): ConnectionProfile {
  return PROFILES[provider];
}
