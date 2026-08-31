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
 * FreeSWITCH adapter — softswitch / media server with the broadest media
 * feature set (IVR, recording, transcription, TTS, WebRTC). Honest stub
 * (Phase 12C): not implemented, health UNKNOWN.
 */
@Injectable()
export class FreeSwitchAdapter implements TelecomEngineAdapter {
  readonly type = TelecomEngineType.FREESWITCH;
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
      EngineCapabilityKey.TRANSCRIPTION,
      EngineCapabilityKey.TTS,
      EngineCapabilityKey.CALL_TRANSFER,
      EngineCapabilityKey.CALL_FORWARDING,
      EngineCapabilityKey.SRTP,
      EngineCapabilityKey.TLS,
    ];
  }

  // FreeSWITCH is a full softswitch/media server: routing, registration, media,
  // and origination.
  capabilities(): EngineCapabilities {
    return { health: true, routing: true, registration: true, activeCalls: true, originate: true, configuration: true };
  }

  async healthCheck(): Promise<EngineHealthResult> {
    return { status: HealthStatus.UNKNOWN, detail: "FreeSWITCH adapter not implemented (stub)" };
  }

  async applyConfiguration(_intent: EngineConfigurationIntent, ctx: EngineContext): Promise<EngineOperationResult> {
    throw new EngineError(EngineErrorCode.NOT_IMPLEMENTED, "FreeSWITCH adapter not implemented", ctx.correlationId);
  }
}
