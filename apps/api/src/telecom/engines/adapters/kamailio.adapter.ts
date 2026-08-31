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

  // Kamailio is a SIP signalling proxy/registrar: it routes/registers but does
  // not originate calls or handle media itself.
  capabilities(): EngineCapabilities {
    return { health: true, routing: true, registration: true, activeCalls: true, originate: false, configuration: true };
  }

  async healthCheck(): Promise<EngineHealthResult> {
    return { status: HealthStatus.UNKNOWN, detail: "Kamailio adapter not implemented (stub)" };
  }

  async applyConfiguration(_intent: EngineConfigurationIntent, ctx: EngineContext): Promise<EngineOperationResult> {
    throw new EngineError(EngineErrorCode.NOT_IMPLEMENTED, "Kamailio adapter not implemented", ctx.correlationId);
  }
}
