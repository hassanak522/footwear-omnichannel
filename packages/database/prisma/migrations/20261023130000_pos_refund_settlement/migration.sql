CREATE TABLE "PosRefundSettlement" (
 "id" UUID NOT NULL,
 "returnId" UUID NOT NULL,
 "idempotencyKey" TEXT NOT NULL,
 "method" "PosTenderType" NOT NULL,
 "amount" DECIMAL(12,2) NOT NULL,
 "reference" TEXT,
 "settledById" UUID NOT NULL,
 "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PosRefundSettlement_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PosRefundSettlement_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "PosReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "PosRefundSettlement_amount_positive" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "PosRefundSettlement_idempotencyKey_key" ON "PosRefundSettlement"("idempotencyKey");
CREATE INDEX "PosRefundSettlement_returnId_settledAt_idx" ON "PosRefundSettlement"("returnId","settledAt");
