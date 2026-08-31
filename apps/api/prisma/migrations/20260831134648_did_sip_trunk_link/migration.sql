-- AlterTable
ALTER TABLE "Did" ADD COLUMN     "sipTrunkId" UUID;

-- CreateIndex
CREATE INDEX "Did_sipTrunkId_idx" ON "Did"("sipTrunkId");

-- CreateIndex
CREATE INDEX "Did_routingProfileId_idx" ON "Did"("routingProfileId");

-- CreateIndex
CREATE INDEX "Did_regionId_idx" ON "Did"("regionId");

-- CreateIndex
CREATE INDEX "Did_country_idx" ON "Did"("country");

-- AddForeignKey
ALTER TABLE "Did" ADD CONSTRAINT "Did_sipTrunkId_fkey" FOREIGN KEY ("sipTrunkId") REFERENCES "SipTrunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
