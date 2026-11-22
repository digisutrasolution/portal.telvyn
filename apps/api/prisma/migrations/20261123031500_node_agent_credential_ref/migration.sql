-- AlterEnum
ALTER TYPE "TelecomCredentialType" ADD VALUE 'NODE_AGENT';

-- AlterTable
ALTER TABLE "TelecomNode" ADD COLUMN     "credentialId" UUID;

-- CreateIndex
CREATE INDEX "TelecomNode_credentialId_idx" ON "TelecomNode"("credentialId");

-- AddForeignKey
ALTER TABLE "TelecomNode" ADD CONSTRAINT "TelecomNode_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "TelecomCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
