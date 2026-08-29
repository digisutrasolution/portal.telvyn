-- CreateEnum
CREATE TYPE "TelecomEngineType" AS ENUM ('KAMAILIO', 'ASTERISK', 'FREESWITCH');

-- CreateEnum
CREATE TYPE "TelecomEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "TelecomStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "HealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN', 'DISABLED');

-- CreateEnum
CREATE TYPE "EngineCapabilityKey" AS ENUM ('SIP', 'RTP', 'WEBRTC', 'REGISTRATION', 'INBOUND_CALLS', 'OUTBOUND_CALLS', 'IVR', 'RECORDING', 'TRANSCRIPTION', 'TTS', 'SRTP', 'TLS', 'CALL_TRANSFER', 'CALL_FORWARDING');

-- CreateEnum
CREATE TYPE "Codec" AS ENUM ('PCMU', 'PCMA', 'G722', 'G729', 'OPUS', 'AMR', 'AMR_WB');

-- CreateEnum
CREATE TYPE "CarrierType" AS ENUM ('ORIGINATION', 'TERMINATION', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "SipTransport" AS ENUM ('UDP', 'TCP', 'TLS');

-- CreateEnum
CREATE TYPE "SipTrunkDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "SipAuthMode" AS ENUM ('IP', 'CREDENTIALS');

-- CreateEnum
CREATE TYPE "DidStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'ASSIGNED', 'ACTIVE', 'SUSPENDED', 'PORTING', 'RELEASED');

-- CreateEnum
CREATE TYPE "RoutingDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "TelecomCredentialType" AS ENUM ('SIP_PASSWORD', 'CARRIER_API');

-- CreateEnum
CREATE TYPE "ConfigChangeType" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "HealthEntityType" AS ENUM ('NODE', 'CARRIER', 'ENGINE');

-- CreateTable
CREATE TABLE "Region" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "timezone" TEXT NOT NULL,
    "providerRegion" TEXT,
    "status" "TelecomStatus" NOT NULL DEFAULT 'ACTIVE',
    "failoverRegionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelecomEngine" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "type" "TelecomEngineType" NOT NULL,
    "provider" TEXT,
    "version" TEXT,
    "endpoint" TEXT,
    "environment" "TelecomEnvironment" NOT NULL DEFAULT 'DEVELOPMENT',
    "status" "TelecomStatus" NOT NULL DEFAULT 'DISABLED',
    "regionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TelecomEngine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineCapability" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "engineId" UUID NOT NULL,
    "capability" "EngineCapabilityKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelecomNode" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "engineId" UUID NOT NULL,
    "regionId" UUID,
    "zone" TEXT,
    "environment" "TelecomEnvironment" NOT NULL DEFAULT 'DEVELOPMENT',
    "hostRef" TEXT,
    "status" "TelecomStatus" NOT NULL DEFAULT 'DISABLED',
    "version" TEXT,
    "maxCps" INTEGER,
    "maxConcurrentCalls" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TelecomNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeHealth" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "nodeId" UUID NOT NULL,
    "status" "HealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "latencyMs" INTEGER,
    "lastHeartbeatAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthEvent" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "entityType" "HealthEntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "tenantId" UUID,
    "fromStatus" "HealthStatus",
    "toStatus" "HealthStatus" NOT NULL,
    "reason" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Carrier" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID,
    "name" TEXT NOT NULL,
    "type" "CarrierType" NOT NULL DEFAULT 'BIDIRECTIONAL',
    "country" CHAR(2),
    "regionId" UUID,
    "status" "TelecomStatus" NOT NULL DEFAULT 'DISABLED',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "codecs" "Codec"[],
    "maxCps" INTEGER,
    "maxConcurrentCalls" INTEGER,
    "credentialId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarrierSipEndpoint" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "carrierId" UUID NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 5060,
    "transport" "SipTransport" NOT NULL DEFAULT 'UDP',
    "tls" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CarrierSipEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SipTrunk" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "SipTrunkDirection" NOT NULL DEFAULT 'BIDIRECTIONAL',
    "sipUri" TEXT,
    "host" TEXT,
    "port" INTEGER NOT NULL DEFAULT 5060,
    "transport" "SipTransport" NOT NULL DEFAULT 'UDP',
    "tls" BOOLEAN NOT NULL DEFAULT false,
    "authMode" "SipAuthMode" NOT NULL DEFAULT 'CREDENTIALS',
    "allowedIps" TEXT[],
    "codecs" "Codec"[],
    "srtp" BOOLEAN NOT NULL DEFAULT false,
    "dtmfMode" TEXT,
    "maxCps" INTEGER,
    "maxConcurrentCalls" INTEGER,
    "status" "TelecomStatus" NOT NULL DEFAULT 'DISABLED',
    "credentialId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SipTrunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Did" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "e164" TEXT NOT NULL,
    "tenantId" UUID,
    "country" CHAR(2) NOT NULL,
    "regionId" UUID,
    "carrierId" UUID,
    "status" "DidStatus" NOT NULL DEFAULT 'AVAILABLE',
    "assignedAt" TIMESTAMP(3),
    "routingProfileId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Did_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingProfile" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "RoutingDirection" NOT NULL DEFAULT 'INBOUND',
    "description" TEXT,
    "status" "TelecomStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RoutingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingRule" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "routingProfileId" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "destination" TEXT NOT NULL,
    "carrierId" UUID,
    "failoverDestination" TEXT,
    "failoverAfterSeconds" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelecomCredential" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID,
    "type" "TelecomCredentialType" NOT NULL,
    "label" TEXT NOT NULL,
    "hint" TEXT,
    "secretEnc" TEXT NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TelecomCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelecomConfigVersion" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "changeType" "ConfigChangeType" NOT NULL,
    "previousConfig" JSONB,
    "newConfig" JSONB,
    "actorId" UUID,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelecomConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- CreateIndex
CREATE INDEX "Region_status_idx" ON "Region"("status");

-- CreateIndex
CREATE INDEX "TelecomEngine_type_idx" ON "TelecomEngine"("type");

-- CreateIndex
CREATE INDEX "TelecomEngine_status_idx" ON "TelecomEngine"("status");

-- CreateIndex
CREATE INDEX "TelecomEngine_regionId_idx" ON "TelecomEngine"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "EngineCapability_engineId_capability_key" ON "EngineCapability"("engineId", "capability");

-- CreateIndex
CREATE INDEX "TelecomNode_engineId_idx" ON "TelecomNode"("engineId");

-- CreateIndex
CREATE INDEX "TelecomNode_regionId_idx" ON "TelecomNode"("regionId");

-- CreateIndex
CREATE INDEX "TelecomNode_status_idx" ON "TelecomNode"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NodeHealth_nodeId_key" ON "NodeHealth"("nodeId");

-- CreateIndex
CREATE INDEX "HealthEvent_entityType_entityId_createdAt_idx" ON "HealthEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "HealthEvent_tenantId_createdAt_idx" ON "HealthEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Carrier_tenantId_status_idx" ON "Carrier"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Carrier_status_idx" ON "Carrier"("status");

-- CreateIndex
CREATE INDEX "Carrier_regionId_idx" ON "Carrier"("regionId");

-- CreateIndex
CREATE INDEX "CarrierSipEndpoint_carrierId_idx" ON "CarrierSipEndpoint"("carrierId");

-- CreateIndex
CREATE INDEX "SipTrunk_tenantId_status_idx" ON "SipTrunk"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Did_e164_key" ON "Did"("e164");

-- CreateIndex
CREATE INDEX "Did_tenantId_status_idx" ON "Did"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Did_status_idx" ON "Did"("status");

-- CreateIndex
CREATE INDEX "Did_carrierId_idx" ON "Did"("carrierId");

-- CreateIndex
CREATE INDEX "RoutingProfile_tenantId_idx" ON "RoutingProfile"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingProfile_tenantId_name_key" ON "RoutingProfile"("tenantId", "name");

-- CreateIndex
CREATE INDEX "RoutingRule_routingProfileId_priority_idx" ON "RoutingRule"("routingProfileId", "priority");

-- CreateIndex
CREATE INDEX "TelecomCredential_tenantId_idx" ON "TelecomCredential"("tenantId");

-- CreateIndex
CREATE INDEX "TelecomConfigVersion_entityType_entityId_createdAt_idx" ON "TelecomConfigVersion"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "TelecomConfigVersion_tenantId_createdAt_idx" ON "TelecomConfigVersion"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_failoverRegionId_fkey" FOREIGN KEY ("failoverRegionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelecomEngine" ADD CONSTRAINT "TelecomEngine_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineCapability" ADD CONSTRAINT "EngineCapability_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "TelecomEngine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelecomNode" ADD CONSTRAINT "TelecomNode_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "TelecomEngine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelecomNode" ADD CONSTRAINT "TelecomNode_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeHealth" ADD CONSTRAINT "NodeHealth_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "TelecomNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Carrier" ADD CONSTRAINT "Carrier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Carrier" ADD CONSTRAINT "Carrier_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Carrier" ADD CONSTRAINT "Carrier_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "TelecomCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarrierSipEndpoint" ADD CONSTRAINT "CarrierSipEndpoint_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SipTrunk" ADD CONSTRAINT "SipTrunk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SipTrunk" ADD CONSTRAINT "SipTrunk_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "TelecomCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Did" ADD CONSTRAINT "Did_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Did" ADD CONSTRAINT "Did_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Did" ADD CONSTRAINT "Did_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Did" ADD CONSTRAINT "Did_routingProfileId_fkey" FOREIGN KEY ("routingProfileId") REFERENCES "RoutingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingProfile" ADD CONSTRAINT "RoutingProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_routingProfileId_fkey" FOREIGN KEY ("routingProfileId") REFERENCES "RoutingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelecomCredential" ADD CONSTRAINT "TelecomCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
