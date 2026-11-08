CREATE TABLE "PosExchange" (
 "id" UUID NOT NULL,
 "returnId" UUID NOT NULL,
 "replacementSaleId" UUID NOT NULL,
 "idempotencyKey" TEXT NOT NULL,
 "approvedById" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PosExchange_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PosExchange_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "PosReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "PosExchange_replacementSaleId_fkey" FOREIGN KEY ("replacementSaleId") REFERENCES "PosSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PosExchange_returnId_key" ON "PosExchange"("returnId");
CREATE UNIQUE INDEX "PosExchange_replacementSaleId_key" ON "PosExchange"("replacementSaleId");
CREATE UNIQUE INDEX "PosExchange_idempotencyKey_key" ON "PosExchange"("idempotencyKey");
