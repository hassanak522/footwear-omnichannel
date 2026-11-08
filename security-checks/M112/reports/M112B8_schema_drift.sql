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
ALTER TABLE "PaymentExceptionEvidence" ADD CONSTRAINT "PaymentExceptionEvidence_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "PaymentException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementEntry" ADD CONSTRAINT "SettlementEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SettlementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceJournalLine" ADD CONSTRAINT "FinanceJournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "FinanceJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePostingLine" ADD CONSTRAINT "FinancePostingLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FinancePostingBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
