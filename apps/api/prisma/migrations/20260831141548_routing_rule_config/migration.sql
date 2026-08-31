/*
  Warnings:

  - Added the required column `destinationType` to the `RoutingRule` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RoutingDestinationType" AS ENUM ('SIP_TRUNK', 'PHONE_NUMBER', 'EXTENSION', 'VOICEMAIL', 'WEBHOOK');

-- AlterTable
ALTER TABLE "RoutingRule" ADD COLUMN     "destinationType" "RoutingDestinationType" NOT NULL,
ADD COLUMN     "retryCount" INTEGER,
ADD COLUMN     "schedule" JSONB,
ADD COLUMN     "timeoutSeconds" INTEGER;
