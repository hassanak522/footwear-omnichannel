-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('WAREHOUSE', 'BRANCH', 'ONLINE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING_BALANCE', 'SUPPLIER_RECEIPT', 'SALE', 'SALE_RETURN', 'RESERVATION', 'RESERVATION_RELEASE', 'TRANSFER_DISPATCH', 'TRANSFER_RECEIPT', 'ADJUSTMENT', 'QUARANTINE', 'QUARANTINE_RELEASE');

-- CreateEnum
CREATE TYPE "ReservationPurpose" AS ENUM ('ONLINE_ORDER', 'BRANCH_REPLENISHMENT');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PICKING', 'DISPATCHED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PosShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PosSaleStatus" AS ENUM ('ACCEPTED', 'STOCK_CONFLICT');

-- CreateEnum
CREATE TYPE "PosTenderType" AS ENUM ('CASH', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "PosReturnStatus" AS ENUM ('APPROVED');

-- CreateEnum
CREATE TYPE "OnlineOrderStatus" AS ENUM ('PLACED', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnlinePaymentMethod" AS ENUM ('COD', 'CARD', 'EASYPAISA', 'JAZZCASH');

-- CreateEnum
CREATE TYPE "OnlinePaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('OPEN', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReplenishmentStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "RefundRecordStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PaymentExceptionStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentEvidenceKind" AS ENUM ('CASH_COUNT', 'TERMINAL_RECEIPT', 'BANK_REFERENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "CashReconciliationStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "DrawerMovementType" AS ENUM ('CASH_IN', 'CASH_OUT', 'PETTY_CASH', 'CASH_REFUND', 'BANK_DEPOSIT');

-- CreateEnum
CREATE TYPE "DrawerMovementStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SettlementMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'AMBIGUOUS', 'DISPUTED');

-- CreateEnum
CREATE TYPE "FinanceJournalStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('DRAFT', 'REVIEWED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "SettlementReviewDecision" AS ENUM ('VERIFIED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "FinanceExceptionCaseStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "Location" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "UserLocation" (
    "userId" UUID NOT NULL,
    "locationId" UUID NOT NULL,

    CONSTRAINT "UserLocation_pkey" PRIMARY KEY ("userId","locationId")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" UUID NOT NULL,
    "brandId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "cost" DECIMAL(12,2),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reservedOnline" INTEGER NOT NULL DEFAULT 0,
    "reservedReplenish" INTEGER NOT NULL DEFAULT 0,
    "quarantined" INTEGER NOT NULL DEFAULT 0,
    "safetyBuffer" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "actorId" UUID,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "purpose" "ReservationPurpose" NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "quantity" INTEGER NOT NULL,
    "referenceId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" UUID NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "destinationId" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferItem" (
    "id" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "requestedQty" INTEGER NOT NULL,
    "dispatchedQty" INTEGER NOT NULL DEFAULT 0,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosDevice" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosShift" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "status" "PosShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openingCash" DECIMAL(12,2) NOT NULL,
    "closingCash" DECIMAL(12,2),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PosShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSale" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "localSaleId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "status" "PosSaleStatus" NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" DECIMAL(12,2) NOT NULL,
    "conflictReason" TEXT,

    CONSTRAINT "PosSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSaleLine" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PosSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSaleTender" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "type" "PosTenderType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,

    CONSTRAINT "PosSaleTender_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "reference" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "orderedQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" UUID NOT NULL,
    "countId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER NOT NULL,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailCustomer" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "consentMarketing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceChangeRequest" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "proposedPrice" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedById" UUID NOT NULL,
    "reviewedById" UUID,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "PriceChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplenishmentRequest" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "destinationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReplenishmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "requestedById" UUID NOT NULL,
    "transferId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ReplenishmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleCustomerLink" (
    "saleId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "linkedById" UUID NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleCustomerLink_pkey" PRIMARY KEY ("saleId")
);

-- CreateTable
CREATE TABLE "RefundRecord" (
    "id" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "status" "RefundRecordStatus" NOT NULL DEFAULT 'REQUESTED',
    "reference" TEXT,
    "requestedById" UUID NOT NULL,
    "reviewedById" UUID,
    "settledById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "RefundRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailPromotion" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRedemption" (
    "id" UUID NOT NULL,
    "promotionId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "customerId" UUID,
    "discountAmount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyLedgerEntry" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "saleId" UUID,
    "returnId" UUID,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentException" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "localSaleId" UUID NOT NULL,
    "saleId" UUID,
    "status" "PaymentExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "reason" VARCHAR(1000) NOT NULL,
    "expectedAmount" DECIMAL(12,2),
    "observedAmount" DECIMAL(12,2),
    "reportedById" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewNote" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentExceptionEvidence" (
    "id" UUID NOT NULL,
    "exceptionId" UUID NOT NULL,
    "kind" "PaymentEvidenceKind" NOT NULL,
    "reference" VARCHAR(200) NOT NULL,
    "note" VARCHAR(1000) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentExceptionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashReconciliation" (
    "id" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "openingCash" DECIMAL(12,2) NOT NULL,
    "recordedCashSales" DECIMAL(12,2) NOT NULL,
    "expectedCash" DECIMAL(12,2) NOT NULL,
    "countedCash" DECIMAL(12,2) NOT NULL,
    "variance" DECIMAL(12,2) NOT NULL,
    "status" "CashReconciliationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "cashierNote" VARCHAR(1000) NOT NULL,
    "submittedById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" VARCHAR(2000),

    CONSTRAINT "CashReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawerMovement" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "type" "DrawerMovementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "externalReference" VARCHAR(200),
    "status" "DrawerMovementStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewNote" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "DrawerMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementBatch" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "provider" VARCHAR(100) NOT NULL,
    "statementReference" VARCHAR(200) NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementEntry" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "externalId" VARCHAR(200) NOT NULL,
    "terminalReference" VARCHAR(200) NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "feeAmount" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "status" "SettlementMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedTenderId" UUID,
    "reviewNote" VARCHAR(1000),
    "reviewedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceJournal" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "externalKey" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "sourceType" VARCHAR(60) NOT NULL,
    "sourceId" VARCHAR(160),
    "status" "FinanceJournalStatus" NOT NULL DEFAULT 'POSTED',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedById" UUID,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" VARCHAR(1000),

    CONSTRAINT "FinanceJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceJournalLine" (
    "id" UUID NOT NULL,
    "journalId" UUID NOT NULL,
    "accountCode" VARCHAR(32) NOT NULL,
    "description" VARCHAR(300),
    "debit" DECIMAL(14,2) NOT NULL,
    "credit" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "FinanceJournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCostBasis" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PKR',
    "sourceNote" VARCHAR(500) NOT NULL,
    "enteredById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCostBasis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "invoiceNumber" VARCHAR(120) NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "note" VARCHAR(1000) NOT NULL,
    "createdById" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayableEvent" (
    "id" UUID NOT NULL,
    "supplierInvoiceId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" VARCHAR(160) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "note" VARCHAR(1000) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayableEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCostRevision" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "previousCost" DECIMAL(12,2),
    "newCost" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryCostRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceSnapshot" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "cashSales" DECIMAL(14,2) NOT NULL,
    "receivables" DECIMAL(14,2) NOT NULL,
    "payables" DECIMAL(14,2) NOT NULL,
    "estimatedStockValue" DECIMAL(14,2) NOT NULL,
    "missingCostVariants" INTEGER NOT NULL DEFAULT 0,
    "sourceNote" VARCHAR(500) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePostingBatch" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "sourceType" VARCHAR(40) NOT NULL,
    "sourceId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'STAGED',
    "memo" VARCHAR(500) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancePostingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePostingLine" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "accountCode" VARCHAR(32) NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL,
    "credit" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "FinancePostingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentRequest" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" VARCHAR(160) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "note" VARCHAR(500) NOT NULL,
    "requestedById" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePeriodLock" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "lockedById" UUID NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancePeriodLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentSettlement" (
    "id" UUID NOT NULL,
    "paymentRequestId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL,
    "bankReference" VARCHAR(160) NOT NULL,
    "evidenceNote" VARCHAR(1000) NOT NULL,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPaymentSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierSettlementReview" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "decision" "SettlementReviewDecision" NOT NULL,
    "evidenceReference" VARCHAR(200) NOT NULL,
    "note" VARCHAR(1000) NOT NULL,
    "reviewerId" UUID NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierSettlementReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceExceptionCase" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "sourceType" VARCHAR(60) NOT NULL,
    "sourceId" UUID NOT NULL,
    "status" "FinanceExceptionCaseStatus" NOT NULL DEFAULT 'OPEN',
    "summary" VARCHAR(500) NOT NULL,
    "resolutionNote" VARCHAR(1000),
    "assignedToId" UUID,
    "openedById" UUID NOT NULL,
    "resolvedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceExceptionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceExceptionCaseEvent" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "note" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceExceptionCaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_barcode_key" ON "ProductVariant"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_size_color_key" ON "ProductVariant"("productId", "size", "color");

-- CreateIndex
CREATE INDEX "StockBalance_variantId_idx" ON "StockBalance"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_locationId_variantId_key" ON "StockBalance"("locationId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_idempotencyKey_key" ON "StockMovement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockMovement_locationId_variantId_createdAt_idx" ON "StockMovement"("locationId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockReservation_referenceId_status_idx" ON "StockReservation"("referenceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_transferNumber_key" ON "StockTransfer"("transferNumber");

-- CreateIndex
CREATE INDEX "StockTransfer_sourceId_status_idx" ON "StockTransfer"("sourceId", "status");

-- CreateIndex
CREATE INDEX "StockTransfer_destinationId_status_idx" ON "StockTransfer"("destinationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransferItem_transferId_variantId_key" ON "StockTransferItem"("transferId", "variantId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_idempotencyKey_key" ON "IntegrationEvent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PosDevice_code_key" ON "PosDevice"("code");

-- CreateIndex
CREATE INDEX "PosShift_deviceId_status_idx" ON "PosShift"("deviceId", "status");

-- CreateIndex
CREATE INDEX "PosSale_locationId_soldAt_idx" ON "PosSale"("locationId", "soldAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosSale_deviceId_localSaleId_key" ON "PosSale"("deviceId", "localSaleId");

-- CreateIndex
CREATE UNIQUE INDEX "PosReturn_idempotencyKey_key" ON "PosReturn"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PosReturn_saleId_createdAt_idx" ON "PosReturn"("saleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosReturnLine_returnId_variantId_key" ON "PosReturnLine"("returnId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrder_orderNumber_key" ON "OnlineOrder"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrder_idempotencyKey_key" ON "OnlineOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OnlineOrder_status_createdAt_idx" ON "OnlineOrder"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrderLine_orderId_variantId_key" ON "OnlineOrderLine"("orderId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_reference_key" ON "PurchaseOrder"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_orderId_variantId_key" ON "PurchaseOrderLine"("orderId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_reference_key" ON "StockCount"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_variantId_key" ON "StockCountLine"("countId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "RetailCustomer_phone_key" ON "RetailCustomer"("phone");

-- CreateIndex
CREATE INDEX "ReplenishmentRequest_destinationId_status_idx" ON "ReplenishmentRequest"("destinationId", "status");

-- CreateIndex
CREATE INDEX "SaleCustomerLink_customerId_linkedAt_idx" ON "SaleCustomerLink"("customerId", "linkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRecord_returnId_key" ON "RefundRecord"("returnId");

-- CreateIndex
CREATE INDEX "RefundRecord_locationId_status_createdAt_idx" ON "RefundRecord"("locationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetailPromotion_code_key" ON "RetailPromotion"("code");

-- CreateIndex
CREATE INDEX "PromotionRedemption_customerId_createdAt_idx" ON "PromotionRedemption"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionRedemption_promotionId_saleId_key" ON "PromotionRedemption"("promotionId", "saleId");

-- CreateIndex
CREATE INDEX "LoyaltyLedgerEntry_customerId_createdAt_idx" ON "LoyaltyLedgerEntry"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyLedgerEntry_saleId_reason_key" ON "LoyaltyLedgerEntry"("saleId", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyLedgerEntry_returnId_reason_key" ON "LoyaltyLedgerEntry"("returnId", "reason");

-- CreateIndex
CREATE INDEX "PaymentException_locationId_status_createdAt_idx" ON "PaymentException"("locationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentException_deviceId_localSaleId_key" ON "PaymentException"("deviceId", "localSaleId");

-- CreateIndex
CREATE INDEX "PaymentExceptionEvidence_exceptionId_createdAt_idx" ON "PaymentExceptionEvidence"("exceptionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashReconciliation_shiftId_key" ON "CashReconciliation"("shiftId");

-- CreateIndex
CREATE INDEX "CashReconciliation_locationId_status_submittedAt_idx" ON "CashReconciliation"("locationId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "DrawerMovement_locationId_shiftId_status_idx" ON "DrawerMovement"("locationId", "shiftId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementBatch_locationId_provider_statementReference_key" ON "SettlementBatch"("locationId", "provider", "statementReference");

-- CreateIndex
CREATE INDEX "SettlementEntry_status_terminalReference_idx" ON "SettlementEntry"("status", "terminalReference");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementEntry_batchId_externalId_key" ON "SettlementEntry"("batchId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementEntry_matchedTenderId_key" ON "SettlementEntry"("matchedTenderId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceJournal_externalKey_key" ON "FinanceJournal"("externalKey");

-- CreateIndex
CREATE INDEX "FinanceJournal_locationId_createdAt_idx" ON "FinanceJournal"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceJournalLine_accountCode_journalId_idx" ON "FinanceJournalLine"("accountCode", "journalId");

-- CreateIndex
CREATE INDEX "InventoryCostBasis_locationId_idx" ON "InventoryCostBasis"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCostBasis_locationId_variantId_key" ON "InventoryCostBasis"("locationId", "variantId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_warehouseId_status_idx" ON "SupplierInvoice"("warehouseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_supplierId_invoiceNumber_key" ON "SupplierInvoice"("supplierId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayableEvent_idempotencyKey_key" ON "SupplierPayableEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplierPayableEvent_supplierInvoiceId_createdAt_idx" ON "SupplierPayableEvent"("supplierInvoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierPayableEvent_warehouseId_createdAt_idx" ON "SupplierPayableEvent"("warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryCostRevision_locationId_variantId_createdAt_idx" ON "InventoryCostRevision"("locationId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceSnapshot_snapshotDate_idx" ON "FinanceSnapshot"("snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSnapshot_locationId_snapshotDate_key" ON "FinanceSnapshot"("locationId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePostingBatch_idempotencyKey_key" ON "FinancePostingBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinancePostingBatch_locationId_createdAt_idx" ON "FinancePostingBatch"("locationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePostingBatch_sourceType_sourceId_key" ON "FinancePostingBatch"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "FinancePostingLine_batchId_idx" ON "FinancePostingLine"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPaymentRequest_idempotencyKey_key" ON "SupplierPaymentRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplierPaymentRequest_invoiceId_status_idx" ON "SupplierPaymentRequest"("invoiceId", "status");

-- CreateIndex
CREATE INDEX "SupplierPaymentRequest_warehouseId_createdAt_idx" ON "SupplierPaymentRequest"("warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancePeriodLock_locationId_periodEnd_idx" ON "FinancePeriodLock"("locationId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePeriodLock_locationId_periodStart_periodEnd_key" ON "FinancePeriodLock"("locationId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPaymentSettlement_paymentRequestId_key" ON "SupplierPaymentSettlement"("paymentRequestId");

-- CreateIndex
CREATE INDEX "SupplierPaymentSettlement_invoiceId_settledAt_idx" ON "SupplierPaymentSettlement"("invoiceId", "settledAt");

-- CreateIndex
CREATE INDEX "SupplierPaymentSettlement_warehouseId_settledAt_idx" ON "SupplierPaymentSettlement"("warehouseId", "settledAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSettlementReview_settlementId_key" ON "SupplierSettlementReview"("settlementId");

-- CreateIndex
CREATE INDEX "SupplierSettlementReview_warehouseId_reviewedAt_idx" ON "SupplierSettlementReview"("warehouseId", "reviewedAt");

-- CreateIndex
CREATE INDEX "FinanceExceptionCase_locationId_status_createdAt_idx" ON "FinanceExceptionCase"("locationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceExceptionCase_locationId_sourceType_sourceId_key" ON "FinanceExceptionCase"("locationId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "FinanceExceptionCaseEvent_caseId_createdAt_idx" ON "FinanceExceptionCaseEvent"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosDevice" ADD CONSTRAINT "PosDevice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PosDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PosDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSaleLine" ADD CONSTRAINT "PosSaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSaleLine" ADD CONSTRAINT "PosSaleLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSaleTender" ADD CONSTRAINT "PosSaleTender_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosReturn" ADD CONSTRAINT "PosReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosReturn" ADD CONSTRAINT "PosReturn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosReturnLine" ADD CONSTRAINT "PosReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "PosReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineOrder" ADD CONSTRAINT "OnlineOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineOrderLine" ADD CONSTRAINT "OnlineOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OnlineOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineOrderLine" ADD CONSTRAINT "OnlineOrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentExceptionEvidence" ADD CONSTRAINT "PaymentExceptionEvidence_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "PaymentException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementEntry" ADD CONSTRAINT "SettlementEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SettlementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceJournalLine" ADD CONSTRAINT "FinanceJournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "FinanceJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePostingLine" ADD CONSTRAINT "FinancePostingLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FinancePostingBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

