-- Merchandise exchange credit is not a physical payment.
ALTER TYPE "PosTenderType"
ADD VALUE IF NOT EXISTS 'EXCHANGE_CREDIT';