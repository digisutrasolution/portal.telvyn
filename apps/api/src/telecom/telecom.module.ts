import { Module } from "@nestjs/common";
import { PrismaService } from "@/infra/prisma.service";
import { RedisService } from "@/infra/redis.service";
import { AuthModule } from "@/auth/auth.module";
import { AuthzModule } from "@/authz/authz.module";
import { EngineRegistryService } from "./engines/engine-registry.service";
import { EngineService } from "./engines/engine.service";
import { EngineConnector } from "./engines/runtime/engine-connector";
import { EngineHttpTransport, NodeHttpsEngineTransport } from "./engines/runtime/engine-http-transport";
import { buildEngineConnector } from "./engines/runtime/engine-connector.factory";
import { EngineConnectionManager } from "./engines/runtime/engine-connection.manager";
import { EngineHealthService } from "./engines/runtime/engine-health.service";
import { EngineLockService } from "./engines/runtime/engine-lock.service";
import { EngineSyncService } from "./engines/runtime/engine-sync.service";
import { KamailioAdapter } from "./engines/adapters/kamailio.adapter";
import { AsteriskAdapter } from "./engines/adapters/asterisk.adapter";
import { FreeSwitchAdapter } from "./engines/adapters/freeswitch.adapter";
import { RegionsService } from "./regions/regions.service";
import { RegionsController } from "./regions/regions.controller";
import { EnginesService } from "./engines/engines.service";
import { EnginesController } from "./engines/engines.controller";
import { EngineAssignmentsService } from "./engines/engine-assignments.service";
import { EngineAssignmentsController } from "./engines/engine-assignments.controller";
import { NodesService } from "./nodes/nodes.service";
import { NodeHealthService } from "./nodes/node-health.service";
import { NodesController } from "./nodes/nodes.controller";
import { TelecomCredentialService } from "./secrets/telecom-credential.service";
import { CarriersService } from "./carriers/carriers.service";
import { CarriersController } from "./carriers/carriers.controller";
import { SipTrunksService } from "./sip-trunks/sip-trunks.service";
import { SipTrunksController } from "./sip-trunks/sip-trunks.controller";
import { DidsService } from "./dids/dids.service";
import { DidsController } from "./dids/dids.controller";
import { RoutingProfilesService } from "./routing-profiles/routing.service";
import { RoutingProfilesController } from "./routing-profiles/routing.controller";
import { LcrService } from "./lcr/lcr.service";
import { LcrController } from "./lcr/lcr.controller";

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
  controllers: [RegionsController, EnginesController, EngineAssignmentsController, NodesController, CarriersController, SipTrunksController, DidsController, RoutingProfilesController, LcrController],
  providers: [
    PrismaService,
    RedisService,
    KamailioAdapter,
    AsteriskAdapter,
    FreeSwitchAdapter,
    EngineRegistryService,
    EngineService,
    // Engine runtime (Phase 12L/12M-3). The connector is the ONLY network seam.
    // Default = honest NullEngineConnector (no egress); the real Kamailio connector
    // engages only when the platform sets ENGINE_CONNECTOR=kamailio (see factory).
    { provide: EngineHttpTransport, useClass: NodeHttpsEngineTransport },
    {
      provide: EngineConnector,
      useFactory: (transport: EngineHttpTransport, vault: TelecomCredentialService) => buildEngineConnector(transport, vault),
      inject: [EngineHttpTransport, TelecomCredentialService],
    },
    EngineConnectionManager,
    EngineHealthService,
    EngineLockService,
    EngineSyncService,
    RegionsService,
    EnginesService,
    EngineAssignmentsService,
    NodesService,
    NodeHealthService,
    TelecomCredentialService,
    CarriersService,
    SipTrunksService,
    DidsService,
    RoutingProfilesService,
    LcrService,
  ],
  exports: [EngineRegistryService, TelecomCredentialService],
})
export class TelecomModule {}
