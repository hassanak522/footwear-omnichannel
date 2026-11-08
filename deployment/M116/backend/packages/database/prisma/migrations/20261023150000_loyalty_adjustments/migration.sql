CREATE TABLE "LoyaltyAdjustment" (
 "id" UUID NOT NULL,
 "customerId" UUID NOT NULL,
 "sourceEntryId" UUID NOT NULL,
 "idempotencyKey" TEXT NOT NULL,
 "points" INTEGER NOT NULL,
 "reason" TEXT NOT NULL,
 "actorId" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "LoyaltyAdjustment_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "LoyaltyAdjustment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "RetailCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "LoyaltyAdjustment_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "LoyaltyEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "LoyaltyAdjustment_negative_points" CHECK ("points" < 0)
);
CREATE UNIQUE INDEX "LoyaltyAdjustment_idempotencyKey_key" ON "LoyaltyAdjustment"("idempotencyKey");
CREATE INDEX "LoyaltyAdjustment_customerId_createdAt_idx" ON "LoyaltyAdjustment"("customerId","createdAt");
CREATE INDEX "LoyaltyAdjustment_sourceEntryId_createdAt_idx" ON "LoyaltyAdjustment"("sourceEntryId","createdAt");
