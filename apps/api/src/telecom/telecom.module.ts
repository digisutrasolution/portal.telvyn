import { Module } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import { AuthModule } from "@/auth/auth.module";
import { AuthzModule } from "@/authz/authz.module";
import { EngineRegistryService } from "./engines/engine-registry.service";
import { KamailioAdapter } from "./engines/adapters/kamailio.adapter";
import { AsteriskAdapter } from "./engines/adapters/asterisk.adapter";
import { FreeSwitchAdapter } from "./engines/adapters/freeswitch.adapter";
import { RegionsService } from "./regions/regions.service";
import { RegionsController } from "./regions/regions.controller";
import { EnginesService } from "./engines/engines.service";
import { EnginesController } from "./engines/engines.controller";
import { NodesService } from "./nodes/nodes.service";
import { NodesController } from "./nodes/nodes.controller";
import { TelecomCredentialService } from "./secrets/telecom-credential.service";
import { CarriersService } from "./carriers/carriers.service";
import { CarriersController } from "./carriers/carriers.controller";
import { SipTrunksService } from "./sip-trunks/sip-trunks.service";
import { SipTrunksController } from "./sip-trunks/sip-trunks.controller";

/**
 * Telecom control plane (Phase 12).
 * 12C — provider-neutral engine abstraction (adapter registry + stubs).
 * 12D — platform infrastructure: Region, TelecomEngine (+capabilities),
 *       TelecomNode (+health). PLATFORM-scoped.
 * 12E — carrier foundation: dual-nature (system/tenant) carriers with the
 *       TelecomCredential vault (secrets never exposed). Tenant-facing.
 * All mutations are audited via the existing AuditService.
 */
@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [RegionsController, EnginesController, NodesController, CarriersController, SipTrunksController],
  providers: [
    PrismaService,
    KamailioAdapter,
    AsteriskAdapter,
    FreeSwitchAdapter,
    EngineRegistryService,
    RegionsService,
    EnginesService,
    NodesService,
    TelecomCredentialService,
    CarriersService,
    SipTrunksService,
  ],
  exports: [EngineRegistryService, TelecomCredentialService],
})
export class TelecomModule {}
