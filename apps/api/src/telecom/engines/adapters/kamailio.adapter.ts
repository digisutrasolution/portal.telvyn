import { Injectable } from "@nestjs/common";
import { EngineCapabilityKey, HealthStatus, TelecomEngineType } from "@prisma/client";
import type { EngineHealthResult, TelecomEngineAdapter } from "../engine-adapter.interface";

/**
 * Kamailio adapter — SIP signalling edge / registrar / router. Media is NOT
 * Kamailio's job (rtpengine handles RTP), so no RTP/recording/IVR capabilities
 * are declared. Honest stub (Phase 12C): not implemented, health UNKNOWN.
 */
@Injectable()
export class KamailioAdapter implements TelecomEngineAdapter {
  readonly type = TelecomEngineType.KAMAILIO;
  readonly implemented = false;

  describeCapabilities(): EngineCapabilityKey[] {
    return [
      EngineCapabilityKey.SIP,
      EngineCapabilityKey.REGISTRATION,
      EngineCapabilityKey.TLS,
      EngineCapabilityKey.INBOUND_CALLS,
      EngineCapabilityKey.OUTBOUND_CALLS,
      EngineCapabilityKey.CALL_FORWARDING,
    ];
  }

  async healthCheck(): Promise<EngineHealthResult> {
    return { status: HealthStatus.UNKNOWN, detail: "Kamailio adapter not implemented (Phase 12C stub)" };
  }
}
