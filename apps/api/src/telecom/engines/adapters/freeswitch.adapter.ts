import { Injectable } from "@nestjs/common";
import { EngineCapabilityKey, HealthStatus, TelecomEngineType } from "@prisma/client";
import type { EngineHealthResult, TelecomEngineAdapter } from "../engine-adapter.interface";

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

  async healthCheck(): Promise<EngineHealthResult> {
    return { status: HealthStatus.UNKNOWN, detail: "FreeSWITCH adapter not implemented (Phase 12C stub)" };
  }
}
