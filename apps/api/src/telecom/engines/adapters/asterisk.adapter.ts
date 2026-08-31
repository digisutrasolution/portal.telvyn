import { Injectable } from "@nestjs/common";
import { EngineCapabilityKey, HealthStatus, TelecomEngineType } from "@prisma/client";
import type { TelecomEngineAdapter } from "../engine-adapter.interface";
import {
  EngineError,
  EngineErrorCode,
  type EngineCapabilities,
  type EngineConfigurationIntent,
  type EngineContext,
  type EngineHealthResult,
  type EngineOperationResult,
} from "../engine.types";

/**
 * Asterisk adapter — B2BUA / PBX with media, IVR, and WebRTC support. Honest
 * stub (Phase 12C): not implemented, health UNKNOWN.
 */
@Injectable()
export class AsteriskAdapter implements TelecomEngineAdapter {
  readonly type = TelecomEngineType.ASTERISK;
  readonly implemented = false;

  describeCapabilities(): EngineCapabilityKey[] {
    return [
      EngineCapabilityKey.SIP,
      EngineCapabilityKey.RTP,
      EngineCapabilityKey.WEBRTC,
      EngineCapabilityKey.REGISTRATION,
      EngineCapabilityKey.INBOUND_CALLS,
      EngineCapabilityKey.OUTBOUND_CALLS,
      EngineCapabilityKey.IVR,
      EngineCapabilityKey.RECORDING,
      EngineCapabilityKey.CALL_TRANSFER,
      EngineCapabilityKey.CALL_FORWARDING,
      EngineCapabilityKey.SRTP,
      EngineCapabilityKey.TLS,
    ];
  }

  // Asterisk is a full B2BUA/PBX: routing, registration, media, and origination.
  capabilities(): EngineCapabilities {
    return { health: true, routing: true, registration: true, activeCalls: true, originate: true, configuration: true };
  }

  async healthCheck(): Promise<EngineHealthResult> {
    return { status: HealthStatus.UNKNOWN, detail: "Asterisk adapter not implemented (stub)" };
  }

  async applyConfiguration(_intent: EngineConfigurationIntent, ctx: EngineContext): Promise<EngineOperationResult> {
    throw new EngineError(EngineErrorCode.NOT_IMPLEMENTED, "Asterisk adapter not implemented", ctx.correlationId);
  }
}
