CREATE TABLE "OnlineRefundSettlement" (
 "id" UUID NOT NULL, "returnId" UUID NOT NULL, "idempotencyKey" TEXT NOT NULL,
 "method" TEXT NOT NULL, "amount" DECIMAL(12,2) NOT NULL,
 "reference" TEXT NOT NULL, "settledById" UUID NOT NULL,
 "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "OnlineRefundSettlement_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "OnlineRefundSettlement_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "OnlineReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "OnlineRefundSettlement_amount_check" CHECK ("amount" > 0),
 CONSTRAINT "OnlineRefundSettlement_method_check" CHECK ("method" IN ('CASH','BANK_TRANSFER','CARD','EASYPAISA','JAZZCASH','OTHER'))
);
CREATE UNIQUE INDEX "OnlineRefundSettlement_idempotencyKey_key" ON "OnlineRefundSettlement"("idempotencyKey");
CREATE INDEX "OnlineRefundSettlement_returnId_settledAt_idx" ON "OnlineRefundSettlement"("returnId","settledAt");
