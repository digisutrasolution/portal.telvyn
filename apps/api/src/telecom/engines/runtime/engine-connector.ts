import { Injectable } from "@nestjs/common";
import { HealthStatus, type TelecomEngineType } from "@prisma/client";
import type { ConnectionProfile } from "./connection-profiles";

/**
 * Provider-neutral connection boundary (Phase 12L). A connector is the ONLY
 * thing that would touch the network; everything above it is pure control-plane
 * logic. The foundation ships exactly ONE connector — `NullEngineConnector` —
 * which performs NO egress and honestly reports UNAVAILABLE, because no real
 * telecom engine exists yet. A real connector (future phase) implements this
 * same interface behind the SSRF guard + connection profile.
 */

export interface EngineProbeInput {
  provider: TelecomEngineType;
  /** SSRF-validated, normalized endpoint (scheme//host[:port]) or null if unconfigured. */
  endpoint: string | null;
  profile: ConnectionProfile;
  correlationId: string;
}

export interface EngineProbeResult {
  status: HealthStatus;
  latencyMs?: number;
  /** Safe, human-readable reason — NEVER contains secrets or raw provider errors. */
  detail: string;
  /** True only when a real connection was actually made. */
  contacted: boolean;
}

export abstract class EngineConnector {
  abstract readonly kind: string;
  abstract probe(input: EngineProbeInput): Promise<EngineProbeResult>;
}

/**
 * Honest no-op connector: makes NO network call and never fabricates health.
 * Unconfigured endpoint → UNKNOWN; configured endpoint → UNKNOWN with an
 * explicit "no runtime connector" reason (we will NOT pretend to have reached
 * an engine that does not exist).
 */
@Injectable()
export class NullEngineConnector extends EngineConnector {
  readonly kind = "null";

  async probe(input: EngineProbeInput): Promise<EngineProbeResult> {
    const detail = input.endpoint
      ? "no live engine runtime connector is wired (foundation) — status is unverified"
      : "engine has no management endpoint configured";
    return { status: HealthStatus.UNKNOWN, detail, contacted: false };
  }
}
