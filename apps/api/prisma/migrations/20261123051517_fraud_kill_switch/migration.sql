-- CreateEnum
CREATE TYPE "KillSwitchScope" AS ENUM ('GLOBAL', 'TENANT');

-- CreateTable
CREATE TABLE "KillSwitch" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "scope" "KillSwitchScope" NOT NULL,
    "tenantId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" UUID,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedBy" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KillSwitch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KillSwitch_scope_idx" ON "KillSwitch"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "KillSwitch_scope_tenantId_key" ON "KillSwitch"("scope", "tenantId");

-- AddForeignKey
ALTER TABLE "KillSwitch" ADD CONSTRAINT "KillSwitch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
