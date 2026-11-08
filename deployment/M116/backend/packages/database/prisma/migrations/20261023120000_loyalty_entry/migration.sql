CREATE TABLE "LoyaltyEntry" (
  "id" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "points" INTEGER NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoyaltyEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "RetailCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LoyaltyEntry_points_check" CHECK ("points" >= 0)
);
CREATE UNIQUE INDEX "LoyaltyEntry_orderId_key" ON "LoyaltyEntry"("orderId");
CREATE INDEX "LoyaltyEntry_customerId_createdAt_idx" ON "LoyaltyEntry"("customerId", "createdAt");
