-- CreateEnum
CREATE TYPE "SpendLimitPeriod" AS ENUM ('PER_CALL', 'DAILY', 'MONTHLY');

-- CreateTable
CREATE TABLE "SpendLimit" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "period" "SpendLimitPeriod" NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SpendLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpendLimit_tenantId_period_idx" ON "SpendLimit"("tenantId", "period");

-- CreateIndex
CREATE INDEX "SpendLimit_tenantId_idx" ON "SpendLimit"("tenantId");

-- AddForeignKey
ALTER TABLE "SpendLimit" ADD CONSTRAINT "SpendLimit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
