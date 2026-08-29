import { Injectable } from "@nestjs/common";
import { EngineCapabilityKey, HealthStatus, TelecomEngineType } from "@prisma/client";
import type { EngineHealthResult, TelecomEngineAdapter } from "../engine-adapter.interface";

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

  async healthCheck(): Promise<EngineHealthResult> {
    return { status: HealthStatus.UNKNOWN, detail: "Asterisk adapter not implemented (Phase 12C stub)" };
  }
}
