-- CreateEnum
CREATE TYPE "DestinationMatchType" AS ENUM ('COUNTRY', 'PREFIX');

-- CreateEnum
CREATE TYPE "DestinationAction" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "DestinationRiskClass" AS ENUM ('STANDARD', 'HIGH_COST', 'PREMIUM');

-- CreateTable
CREATE TABLE "DestinationRule" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "matchType" "DestinationMatchType" NOT NULL,
    "matchValue" TEXT NOT NULL,
    "action" "DestinationAction" NOT NULL,
    "riskClass" "DestinationRiskClass" NOT NULL DEFAULT 'STANDARD',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DestinationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DestinationRule_tenantId_matchType_idx" ON "DestinationRule"("tenantId", "matchType");

-- CreateIndex
CREATE INDEX "DestinationRule_tenantId_idx" ON "DestinationRule"("tenantId");

-- AddForeignKey
ALTER TABLE "DestinationRule" ADD CONSTRAINT "DestinationRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
