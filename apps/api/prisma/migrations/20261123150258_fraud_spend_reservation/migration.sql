-- CreateEnum
CREATE TYPE "SpendReservationStatus" AS ENUM ('ACTIVE', 'SETTLED', 'RELEASED', 'EXPIRED');

-- CreateTable
CREATE TABLE "SpendReservation" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenantId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "settledMicros" BIGINT,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "status" "SpendReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "correlationId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpendReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpendReservation_tenantId_status_createdAt_idx" ON "SpendReservation"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SpendReservation_status_expiresAt_idx" ON "SpendReservation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpendReservation_tenantId_idempotencyKey_key" ON "SpendReservation"("tenantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "SpendReservation" ADD CONSTRAINT "SpendReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
