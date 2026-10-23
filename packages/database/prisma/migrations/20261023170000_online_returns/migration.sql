CREATE TABLE "OnlineReturn" (
 "id" UUID NOT NULL, "orderId" UUID NOT NULL, "idempotencyKey" TEXT NOT NULL,
 "reason" TEXT NOT NULL, "approvedById" UUID NOT NULL,
 "merchandiseAmount" DECIMAL(12,2) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "OnlineReturn_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "OnlineReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OnlineOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "OnlineReturn_merchandiseAmount_check" CHECK ("merchandiseAmount" >= 0)
);
CREATE UNIQUE INDEX "OnlineReturn_idempotencyKey_key" ON "OnlineReturn"("idempotencyKey");
CREATE INDEX "OnlineReturn_orderId_createdAt_idx" ON "OnlineReturn"("orderId","createdAt");
CREATE TABLE "OnlineReturnLine" (
 "id" UUID NOT NULL, "returnId" UUID NOT NULL, "variantId" UUID NOT NULL,
 "quantity" INTEGER NOT NULL, "quarantined" BOOLEAN NOT NULL DEFAULT false,
 "unitPrice" DECIMAL(12,2) NOT NULL,
 CONSTRAINT "OnlineReturnLine_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "OnlineReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "OnlineReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "OnlineReturnLine_quantity_check" CHECK ("quantity" > 0)
);
CREATE UNIQUE INDEX "OnlineReturnLine_returnId_variantId_key" ON "OnlineReturnLine"("returnId","variantId");
