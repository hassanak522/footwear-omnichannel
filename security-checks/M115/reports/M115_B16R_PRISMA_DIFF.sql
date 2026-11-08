-- DropForeignKey
ALTER TABLE "PosRefundSettlement" DROP CONSTRAINT "PosRefundSettlement_payoutShiftId_fkey";

-- DropIndex
DROP INDEX "PosRefundSettlement_payoutShiftId_settledAt_idx";

-- AddForeignKey
ALTER TABLE "PosRefundSettlement" ADD CONSTRAINT "PosRefundSettlement_payoutShiftId_fkey" FOREIGN KEY ("payoutShiftId") REFERENCES "PosShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

