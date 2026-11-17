-- CreateEnum
CREATE TYPE "EngineResourceKind" AS ENUM ('SIP_TRUNK', 'DID', 'ROUTING_PROFILE');

-- CreateTable
CREATE TABLE "EngineResourceAssignment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "engineId" UUID NOT NULL,
    "kind" "EngineResourceKind" NOT NULL,
    "tenantId" UUID,
    "sipTrunkId" UUID,
    "didId" UUID,
    "routingProfileId" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EngineResourceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngineResourceAssignment_engineId_enabled_idx" ON "EngineResourceAssignment"("engineId", "enabled");

-- CreateIndex
CREATE INDEX "EngineResourceAssignment_tenantId_idx" ON "EngineResourceAssignment"("tenantId");

-- CreateIndex
CREATE INDEX "EngineResourceAssignment_kind_idx" ON "EngineResourceAssignment"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "EngineResourceAssignment_engineId_sipTrunkId_key" ON "EngineResourceAssignment"("engineId", "sipTrunkId");

-- CreateIndex
CREATE UNIQUE INDEX "EngineResourceAssignment_engineId_didId_key" ON "EngineResourceAssignment"("engineId", "didId");

-- CreateIndex
CREATE UNIQUE INDEX "EngineResourceAssignment_engineId_routingProfileId_key" ON "EngineResourceAssignment"("engineId", "routingProfileId");

-- AddForeignKey
ALTER TABLE "EngineResourceAssignment" ADD CONSTRAINT "EngineResourceAssignment_engineId_fkey" FOREIGN KEY ("engineId") REFERENCES "TelecomEngine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineResourceAssignment" ADD CONSTRAINT "EngineResourceAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineResourceAssignment" ADD CONSTRAINT "EngineResourceAssignment_sipTrunkId_fkey" FOREIGN KEY ("sipTrunkId") REFERENCES "SipTrunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineResourceAssignment" ADD CONSTRAINT "EngineResourceAssignment_didId_fkey" FOREIGN KEY ("didId") REFERENCES "Did"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineResourceAssignment" ADD CONSTRAINT "EngineResourceAssignment_routingProfileId_fkey" FOREIGN KEY ("routingProfileId") REFERENCES "RoutingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity (Phase 12N): exactly ONE resource FK is set, and it matches `kind`.
-- Enforced in the database so no code path can persist an ambiguous assignment.
ALTER TABLE "EngineResourceAssignment" ADD CONSTRAINT "EngineResourceAssignment_one_resource_matches_kind" CHECK (
    ("kind" = 'SIP_TRUNK'       AND "sipTrunkId" IS NOT NULL AND "didId" IS NULL AND "routingProfileId" IS NULL)
 OR ("kind" = 'DID'             AND "didId" IS NOT NULL AND "sipTrunkId" IS NULL AND "routingProfileId" IS NULL)
 OR ("kind" = 'ROUTING_PROFILE' AND "routingProfileId" IS NOT NULL AND "sipTrunkId" IS NULL AND "didId" IS NULL)
);
