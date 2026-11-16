-- AlterEnum
ALTER TYPE "TelecomCredentialType" ADD VALUE 'ENGINE_API';

-- AlterTable
ALTER TABLE "TelecomEngine" ADD COLUMN     "credentialId" UUID;

-- CreateIndex
CREATE INDEX "TelecomEngine_credentialId_idx" ON "TelecomEngine"("credentialId");

-- AddForeignKey
ALTER TABLE "TelecomEngine" ADD CONSTRAINT "TelecomEngine_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "TelecomCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
