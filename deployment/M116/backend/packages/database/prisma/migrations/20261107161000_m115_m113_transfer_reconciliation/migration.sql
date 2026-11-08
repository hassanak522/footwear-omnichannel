-- AlterEnum
ALTER TYPE "TransferStatus" ADD VALUE 'SHORTAGE_CLOSED';

-- AlterTable
ALTER TABLE "StockTransferItem" ADD COLUMN     "shortageQty" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StockTransferReceipt" (
    "id" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "damagedQty" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransferReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockTransferReceipt_transferId_createdAt_idx" ON "StockTransferReceipt"("transferId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransferReceipt_transferId_variantId_idempotencyKey_key" ON "StockTransferReceipt"("transferId", "variantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "StockTransferReceipt" ADD CONSTRAINT "StockTransferReceipt_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
