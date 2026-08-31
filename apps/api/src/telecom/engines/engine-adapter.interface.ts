import type { EngineCapabilityKey, TelecomEngineType } from "@prisma/client";
import type {
  EngineCapabilities,
  EngineConfigurationIntent,
  EngineContext,
  EngineHealthResult,
  EngineOperationResult,
} from "./engine.types";

// Re-exported for backward compatibility (defined in engine.types.ts).
export type { EngineHealthResult } from "./engine.types";

/**
 * Provider-neutral telecom engine adapter (ADR-0007). The SINGLE integration
 * boundary between the control plane and a telecom engine (Kamailio / Asterisk
 * / FreeSWITCH / future). No service talks to an engine except through an
 * adapter, and adapters are HONEST about their status:
 *
 *   - `implemented` is false until a real integration is wired.
 *   - `healthCheck()` returns UNKNOWN (never HEALTHY) when nothing was actually
 *     probed — no fabricated health, ever.
 *   - Orchestration calls (e.g. `applyConfiguration`) throw a normalized
 *     `EngineError(NOT_IMPLEMENTED)` until a real integration exists — no fake
 *     success, no engine connectivity.
 */
export interface TelecomEngineAdapter {
  /** The engine software this adapter drives. */
  readonly type: TelecomEngineType;

  /** True only when a real integration exists. False = honest stub. */
  readonly implemented: boolean;

  /**
   * Static capability profile: what this engine SOFTWARE supports by design.
   * Honest metadata about the engine, NOT live discovery and NOT a specific
   * instance's admin-enabled `EngineCapability` rows.
   */
  describeCapabilities(): EngineCapabilityKey[];

  /** Structured capability flags (explicit — never inferred from `type`). */
  capabilities(): EngineCapabilities;

  /**
   * Probe a live engine's health. A stub adapter returns `UNKNOWN` — it has
   * not contacted anything, so it must not claim `HEALTHY`.
   */
  healthCheck(): Promise<EngineHealthResult>;

  /**
   * Apply a provider-neutral configuration intent to the engine. A stub adapter
   * throws `EngineError(NOT_IMPLEMENTED)` — it performs NO engine connectivity
   * and never fabricates success. Real adapters (future) translate the intent
   * into engine-specific config idempotently.
   */
  applyConfiguration(intent: EngineConfigurationIntent, ctx: EngineContext): Promise<EngineOperationResult>;
}
