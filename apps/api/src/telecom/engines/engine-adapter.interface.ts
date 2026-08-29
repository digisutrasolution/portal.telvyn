import type { EngineCapabilityKey, HealthStatus, TelecomEngineType } from "@prisma/client";

/** Result of probing a live engine's health (ADR-0007 / ADR-0010). */
export interface EngineHealthResult {
  status: HealthStatus;
  latencyMs?: number;
  /** Human-readable context — never contains secrets. */
  detail?: string;
}

/**
 * Provider-neutral telecom engine adapter (ADR-0007). The SINGLE integration
 * boundary between the control plane and a telecom engine (Kamailio / Asterisk
 * / FreeSWITCH / future). No service talks to an engine except through an
 * adapter, and adapters are HONEST about their status:
 *
 *   - `implemented` is false until a real integration is wired.
 *   - `healthCheck()` returns UNKNOWN (never HEALTHY) when nothing was actually
 *     probed — no fabricated health, ever.
 *   - Orchestration calls (added in later phases) throw until implemented.
 */
export interface TelecomEngineAdapter {
  /** The engine software this adapter drives. */
  readonly type: TelecomEngineType;

  /** True only when a real integration exists. False = honest stub. */
  readonly implemented: boolean;

  /**
   * Static capability profile: what this engine SOFTWARE supports by design.
   * This is honest metadata about the engine, NOT live discovery and NOT a
   * specific instance's enabled capabilities (those are admin-configured
   * `EngineCapability` rows, per engine, added in a later phase).
   */
  describeCapabilities(): EngineCapabilityKey[];

  /**
   * Probe a live engine's health. A stub adapter returns `UNKNOWN` — it has
   * not contacted anything, so it must not claim `HEALTHY`.
   */
  healthCheck(): Promise<EngineHealthResult>;
}
