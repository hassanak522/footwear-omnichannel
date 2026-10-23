ALTER TABLE "PosRefundSettlement" ADD COLUMN "payoutShiftId" UUID;
ALTER TABLE "PosRefundSettlement" ADD CONSTRAINT "PosRefundSettlement_payoutShiftId_fkey" FOREIGN KEY ("payoutShiftId") REFERENCES "PosShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PosRefundSettlement_payoutShiftId_settledAt_idx" ON "PosRefundSettlement"("payoutShiftId","settledAt");
