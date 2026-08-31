-- CreateEnum
CREATE TYPE "RoutingSelectionStrategy" AS ENUM ('PRIORITY', 'WEIGHTED', 'ROUND_ROBIN', 'SIMULTANEOUS');

-- CreateEnum
CREATE TYPE "RoutingFailoverCondition" AS ENUM ('NO_ANSWER', 'BUSY', 'FAILED', 'UNREACHABLE', 'TIMEOUT');

-- AlterTable
ALTER TABLE "RoutingProfile" ADD COLUMN     "failoverConditions" "RoutingFailoverCondition"[],
ADD COLUMN     "failoverEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxAttempts" INTEGER,
ADD COLUMN     "overallTimeoutSeconds" INTEGER,
ADD COLUMN     "selectionStrategy" "RoutingSelectionStrategy" NOT NULL DEFAULT 'PRIORITY',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RoutingRule" ADD COLUMN     "failoverDestinationType" "RoutingDestinationType",
ADD COLUMN     "weight" INTEGER;
