-- CreateTable
CREATE TABLE "StockAvailabilitySnapshot" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "onHand" INTEGER NOT NULL,
    "quarantined" INTEGER NOT NULL,
    "reservedOnline" INTEGER NOT NULL,
    "reservedReplenish" INTEGER NOT NULL,
    "safetyBuffer" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,

    CONSTRAINT "StockAvailabilitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockAvailabilitySnapshot_locationId_variantId_capturedAt_idx" ON "StockAvailabilitySnapshot"("locationId", "variantId", "capturedAt");

-- CreateIndex
CREATE INDEX "StockAvailabilitySnapshot_batchId_idx" ON "StockAvailabilitySnapshot"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAvailabilitySnapshot_batchId_locationId_variantId_key" ON "StockAvailabilitySnapshot"("batchId", "locationId", "variantId");
