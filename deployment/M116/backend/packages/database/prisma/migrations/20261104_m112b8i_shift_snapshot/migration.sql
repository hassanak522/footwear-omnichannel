CREATE TABLE "PosShiftClosingSnapshot" (
    "id" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "openingCash" DECIMAL(12,2) NOT NULL,
    "cashSales" DECIMAL(12,2) NOT NULL,
    "cardSales" DECIMAL(12,2) NOT NULL,
    "otherSales" DECIMAL(12,2) NOT NULL,
    "expectedCash" DECIMAL(12,2) NOT NULL,
    "countedCash" DECIMAL(12,2) NOT NULL,
    "variance" DECIMAL(12,2) NOT NULL,
    "drawerAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "approvedMovements" INTEGER NOT NULL DEFAULT 0,
    "acceptedSales" INTEGER NOT NULL,
    "conflictedSales" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosShiftClosingSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosShiftClosingSnapshot_shiftId_key"
ON "PosShiftClosingSnapshot"("shiftId");

CREATE INDEX "PosShiftClosingSnapshot_locationId_closedAt_idx"
ON "PosShiftClosingSnapshot"("locationId", "closedAt");