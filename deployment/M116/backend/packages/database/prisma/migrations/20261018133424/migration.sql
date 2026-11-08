-- CreateEnum
CREATE TYPE "PosReturnStatus" AS ENUM ('APPROVED');

-- CreateTable
CREATE TABLE "PosReturn" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "PosReturnStatus" NOT NULL DEFAULT 'APPROVED',
    "reason" TEXT NOT NULL,
    "approvedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosReturnLine" (
    "id" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "quarantined" BOOLEAN NOT NULL DEFAULT false,
    "refundAmount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PosReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosReturn_idempotencyKey_key" ON "PosReturn"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PosReturn_saleId_createdAt_idx" ON "PosReturn"("saleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosReturnLine_returnId_variantId_key" ON "PosReturnLine"("returnId", "variantId");

-- AddForeignKey
ALTER TABLE "PosReturn" ADD CONSTRAINT "PosReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosReturn" ADD CONSTRAINT "PosReturn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosReturnLine" ADD CONSTRAINT "PosReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "PosReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
