CREATE TABLE "LoyaltyRedemption" (
 "id" UUID NOT NULL,
 "customerId" UUID NOT NULL,
 "idempotencyKey" TEXT NOT NULL,
 "points" INTEGER NOT NULL,
 "reference" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "actorId" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "LoyaltyRedemption_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "LoyaltyRedemption_points_check" CHECK ("points" > 0)
);
CREATE UNIQUE INDEX "LoyaltyRedemption_idempotencyKey_key" ON "LoyaltyRedemption"("idempotencyKey");
CREATE INDEX "LoyaltyRedemption_customerId_createdAt_idx" ON "LoyaltyRedemption"("customerId","createdAt");
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "RetailCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
