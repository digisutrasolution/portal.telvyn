-- CreateEnum
CREATE TYPE "VelocityMetric" AS ENUM ('CALLS_PER_MINUTE', 'CALLS_PER_HOUR', 'CALLS_PER_DAY', 'CONCURRENT_CALLS');

-- CreateTable
CREATE TABLE "VelocityLimit" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "metric" "VelocityMetric" NOT NULL,
    "limit" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VelocityLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VelocityLimit_tenantId_metric_idx" ON "VelocityLimit"("tenantId", "metric");

-- CreateIndex
CREATE INDEX "VelocityLimit_tenantId_idx" ON "VelocityLimit"("tenantId");

-- AddForeignKey
ALTER TABLE "VelocityLimit" ADD CONSTRAINT "VelocityLimit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
