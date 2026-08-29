/*
  Warnings:

  - Added the required column `carrierId` to the `SipTrunk` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SipTrunk" ADD COLUMN     "carrierId" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "SipTrunk_carrierId_idx" ON "SipTrunk"("carrierId");

-- AddForeignKey
ALTER TABLE "SipTrunk" ADD CONSTRAINT "SipTrunk_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
