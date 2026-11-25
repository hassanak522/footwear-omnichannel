-- R10.3D23B: Preserve non-cash exchange credit independently.
ALTER TABLE "PosShiftClosingSnapshot"
ADD COLUMN IF NOT EXISTS "exchangeCredit"
DECIMAL(12,2) NOT NULL DEFAULT 0;