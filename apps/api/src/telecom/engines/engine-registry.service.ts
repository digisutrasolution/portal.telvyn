import { Injectable } from "@nestjs/common";
import type { TelecomEngineType } from "@prisma/client";
import type { TelecomEngineAdapter } from "./engine-adapter.interface";
import { KamailioAdapter } from "./adapters/kamailio.adapter";
import { AsteriskAdapter } from "./adapters/asterisk.adapter";
import { FreeSwitchAdapter } from "./adapters/freeswitch.adapter";

/**
 * Central registry of telecom engine adapters (ADR-0007). Maps a persisted
 * engine's `type` to its adapter instance — the only place adapters are
 * resolved. Adding an engine = a new adapter + one entry here, no business
 * logic change.
 */
@Injectable()
export class EngineRegistryService {
  private readonly adapters: Map<TelecomEngineType, TelecomEngineAdapter>;

  constructor(kamailio: KamailioAdapter, asterisk: AsteriskAdapter, freeswitch: FreeSwitchAdapter) {
    this.adapters = new Map<TelecomEngineType, TelecomEngineAdapter>([
      [kamailio.type, kamailio],
      [asterisk.type, asterisk],
      [freeswitch.type, freeswitch],
    ]);
  }

  /** Resolve the adapter for an engine type. Throws on an unregistered type. */
  getAdapter(type: TelecomEngineType): TelecomEngineAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new Error(`No telecom engine adapter registered for type: ${type}`);
    return adapter;
  }

  /** Whether a real (non-stub) integration exists for an engine type. */
  isImplemented(type: TelecomEngineType): boolean {
    return this.getAdapter(type).implemented;
  }

  /** All registered adapters (e.g. for a capability catalog). */
  listAdapters(): TelecomEngineAdapter[] {
    return [...this.adapters.values()];
  }
}
