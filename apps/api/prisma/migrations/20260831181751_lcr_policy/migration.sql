-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'JPY');

-- CreateEnum
CREATE TYPE "LcrSelectionStrategy" AS ENUM ('LOWEST_COST', 'HIGHEST_PRIORITY', 'WEIGHTED', 'QUALITY_FIRST');

-- CreateTable
CREATE TABLE "LcrPolicy" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "selectionStrategy" "LcrSelectionStrategy" NOT NULL DEFAULT 'LOWEST_COST',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LcrPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcrRoute" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "lcrPolicyId" UUID NOT NULL,
    "carrierId" UUID NOT NULL,
    "sipTrunkId" UUID,
    "prefix" TEXT NOT NULL,
    "country" CHAR(2),
    "costMicros" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "weight" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LcrRoute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LcrPolicy_tenantId_idx" ON "LcrPolicy"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LcrPolicy_tenantId_name_key" ON "LcrPolicy"("tenantId", "name");

-- CreateIndex
CREATE INDEX "LcrRoute_lcrPolicyId_prefix_idx" ON "LcrRoute"("lcrPolicyId", "prefix");

-- CreateIndex
CREATE INDEX "LcrRoute_lcrPolicyId_enabled_idx" ON "LcrRoute"("lcrPolicyId", "enabled");

-- CreateIndex
CREATE INDEX "LcrRoute_carrierId_idx" ON "LcrRoute"("carrierId");

-- AddForeignKey
ALTER TABLE "LcrPolicy" ADD CONSTRAINT "LcrPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcrRoute" ADD CONSTRAINT "LcrRoute_lcrPolicyId_fkey" FOREIGN KEY ("lcrPolicyId") REFERENCES "LcrPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcrRoute" ADD CONSTRAINT "LcrRoute_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcrRoute" ADD CONSTRAINT "LcrRoute_sipTrunkId_fkey" FOREIGN KEY ("sipTrunkId") REFERENCES "SipTrunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
