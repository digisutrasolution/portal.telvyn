import type { HealthStatus, TelecomEngineType } from "@prisma/client";

/**
 * Provider-neutral engine abstraction types (Phase 12K). These define the
 * contract between the control plane and FUTURE telecom-engine adapters
 * (Kamailio / FreeSWITCH / Asterisk). NOTHING here executes SIP/RTP or contacts
 * an engine; adapters remain honest stubs until a real integration is wired.
 * Secrets NEVER appear in any of these shapes.
 */

/** Structured, explicit capability flags (never inferred from engine type). */
export interface EngineCapabilities {
  health: boolean;
  routing: boolean;
  registration: boolean;
  activeCalls: boolean;
  originate: boolean;
  configuration: boolean;
}

/** Result of probing a live engine's health (ADR-0007 / ADR-0010). */
export interface EngineHealthResult {
  status: HealthStatus;
  latencyMs?: number;
  /** Human-readable context — never contains secrets. */
  detail?: string;
}

/** Per-operation context: correlation + bounded timeout (never infinite). */
export interface EngineContext {
  correlationId: string;
  timeoutMs: number;
  engineId?: string;
}

/** Normalized engine status (capabilities + honest health + implemented flag). */
export interface EngineStatus {
  engineId?: string;
  provider: TelecomEngineType;
  implemented: boolean;
  capabilities: EngineCapabilities;
  health: EngineHealthResult;
  correlationId: string;
  checkedAt: Date;
}

/** Platform-normalized engine error codes — engine-specific errors never leak. */
export enum EngineErrorCode {
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
  UNAVAILABLE = "UNAVAILABLE",
  TIMEOUT = "TIMEOUT",
  INVALID_CONFIG = "INVALID_CONFIG",
  UNSUPPORTED = "UNSUPPORTED",
  INTERNAL = "INTERNAL",
}

/** A normalized engine error. Messages must never carry secrets. */
export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** Outcome of an engine operation (normalized, observability-friendly). */
export interface EngineOperationResult {
  ok: boolean;
  outcome: "OK" | "NOT_IMPLEMENTED" | "ERROR";
  code?: EngineErrorCode;
  correlationId: string;
  durationMs: number;
  detail?: string;
}

/**
 * Provider-neutral DESIRED-STATE configuration intent that a future adapter will
 * translate into engine-specific config. Carries only id references and
 * non-secret config — NEVER credentials/secrets. Not persisted in 12K.
 */
export interface EngineConfigurationIntent {
  engineType: TelecomEngineType;
  carriers: { id: string; name: string; priority: number; credentialRef: string | null }[];
  trunks: { id: string; name: string; host: string | null; transport: string; credentialRef: string | null }[];
  dids: { id: string; e164: string; carrierId: string | null; sipTrunkId: string | null }[];
  routes: { id: string; destinationType: string; priority: number }[];
}
