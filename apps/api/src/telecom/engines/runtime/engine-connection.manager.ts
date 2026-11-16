import { Injectable } from "@nestjs/common";
import { TelecomStatus, type TelecomEngineType } from "@prisma/client";
import { EngineConnector, type EngineProbeResult } from "./engine-connector";
import { connectionProfile } from "./connection-profiles";
import { parseEngineEndpoint } from "./engine-endpoint";

/** Normalized reachability posture (never leaks provider internals). */
export type ReachabilityState = "UNCONFIGURED" | "DISABLED" | "BLOCKED" | "UNVERIFIED" | "REACHABLE" | "UNREACHABLE";

export interface EngineConnectionInput {
  provider: TelecomEngineType;
  endpoint: string | null;
  credentialId?: string | null;
  status: TelecomStatus;
  correlationId: string;
}

export interface EngineConnectionResult {
  state: ReachabilityState;
  endpointConfigured: boolean;
  /** Safe reason — no secrets, no raw endpoint credentials, no provider errors. */
  detail: string;
  probe?: EngineProbeResult;
}

/**
 * Resolves an engine's management endpoint, enforces the SSRF egress policy, and
 * delegates the actual reachability probe to the injected connector. With the
 * foundation's `NullEngineConnector` no egress occurs; a BLOCKED endpoint is
 * refused BEFORE any connector call.
 */
@Injectable()
export class EngineConnectionManager {
  constructor(private readonly connector: EngineConnector) {}

  async resolve(input: EngineConnectionInput): Promise<EngineConnectionResult> {
    const endpointConfigured = !!input.endpoint && input.endpoint.trim().length > 0;
    if (!endpointConfigured) {
      return { state: "UNCONFIGURED", endpointConfigured: false, detail: "no management endpoint configured" };
    }
    if (input.status === TelecomStatus.DISABLED) {
      return { state: "DISABLED", endpointConfigured: true, detail: "engine is administratively disabled" };
    }

    const parsed = parseEngineEndpoint(input.endpoint);
    if (!parsed.ok) {
      // SSRF / malformed endpoint — refuse egress, do not contact the connector.
      return { state: "BLOCKED", endpointConfigured: true, detail: `endpoint rejected: ${parsed.reason}` };
    }

    const profile = connectionProfile(input.provider);
    const probe = await this.connector.probe({
      provider: input.provider,
      endpoint: parsed.normalized ?? null,
      credentialId: input.credentialId ?? null,
      profile,
      correlationId: input.correlationId,
    });
    const state: ReachabilityState = probe.contacted ? (probe.latencyMs !== undefined ? "REACHABLE" : "UNREACHABLE") : "UNVERIFIED";
    return { state, endpointConfigured: true, detail: probe.detail, probe };
  }
}
