-- CreateEnum
CREATE TYPE "OnlineOrderStatus" AS ENUM ('PLACED', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnlinePaymentMethod" AS ENUM ('COD', 'CARD', 'EASYPAISA', 'JAZZCASH');

-- CreateEnum
CREATE TYPE "OnlinePaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "OnlineOrder" (
    "id" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "paymentMethod" "OnlinePaymentMethod" NOT NULL,
    "paymentStatus" "OnlinePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "status" "OnlineOrderStatus" NOT NULL DEFAULT 'PLACED',
    "courierName" TEXT,
    "trackingNumber" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "shippingFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dispatchedAt" TIMESTAMP(3),

    CONSTRAINT "OnlineOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineOrderLine" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "OnlineOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrder_orderNumber_key" ON "OnlineOrder"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrder_idempotencyKey_key" ON "OnlineOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OnlineOrder_status_createdAt_idx" ON "OnlineOrder"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrderLine_orderId_variantId_key" ON "OnlineOrderLine"("orderId", "variantId");

-- AddForeignKey
ALTER TABLE "OnlineOrder" ADD CONSTRAINT "OnlineOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineOrderLine" ADD CONSTRAINT "OnlineOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OnlineOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineOrderLine" ADD CONSTRAINT "OnlineOrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
