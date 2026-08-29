import { Module } from "@nestjs/common";
import { EngineRegistryService } from "./engines/engine-registry.service";
import { KamailioAdapter } from "./engines/adapters/kamailio.adapter";
import { AsteriskAdapter } from "./engines/adapters/asterisk.adapter";
import { FreeSwitchAdapter } from "./engines/adapters/freeswitch.adapter";

/**
 * Telecom control plane (Phase 12). 12C establishes the provider-neutral
 * engine abstraction (ADR-0007): the adapter registry + honest NOT-IMPLEMENTED
 * engine adapters. Resource services/controllers are added in later sub-phases.
 */
@Module({
  providers: [KamailioAdapter, AsteriskAdapter, FreeSwitchAdapter, EngineRegistryService],
  exports: [EngineRegistryService],
})
export class TelecomModule {}
