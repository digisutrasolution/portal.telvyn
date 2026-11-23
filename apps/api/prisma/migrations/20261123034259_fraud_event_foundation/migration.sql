-- CreateEnum
CREATE TYPE "FraudEventType" AS ENUM ('AUTHORIZATION_DENIED', 'LIMIT_WARNING', 'KILL_SWITCH', 'POLICY_CHANGE', 'ANOMALY');

-- CreateEnum
CREATE TYPE "FraudEventSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "FraudEvent" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "type" "FraudEventType" NOT NULL,
    "severity" "FraudEventSeverity" NOT NULL DEFAULT 'WARNING',
    "source" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "reason" TEXT,
    "correlationId" TEXT,
    "actorId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FraudEvent_tenantId_createdAt_idx" ON "FraudEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudEvent_tenantId_type_createdAt_idx" ON "FraudEvent"("tenantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "FraudEvent_tenantId_severity_createdAt_idx" ON "FraudEvent"("tenantId", "severity", "createdAt");

-- AddForeignKey
ALTER TABLE "FraudEvent" ADD CONSTRAINT "FraudEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
