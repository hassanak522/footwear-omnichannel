-- CreateEnum
CREATE TYPE "ReplenishmentStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'FULFILLED');

-- AlterEnum
ALTER TYPE "LocationType" ADD VALUE 'ONLINE';

-- CreateTable
CREATE TABLE "ReplenishmentRequest" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "destinationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReplenishmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "requestedById" UUID NOT NULL,
    "transferId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ReplenishmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplenishmentRequest_destinationId_status_idx" ON "ReplenishmentRequest"("destinationId", "status");
