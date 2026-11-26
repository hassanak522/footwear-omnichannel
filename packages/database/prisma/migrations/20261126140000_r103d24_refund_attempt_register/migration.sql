CREATE TABLE "PosRefundAttempt" (
    "id" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "registeredById" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PosTenderType" NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "paymentState" TEXT NOT NULL DEFAULT 'UNCONFIRMED',
    "settlementId" UUID,
    "resolutionReason" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosRefundAttempt_pkey"
        PRIMARY KEY ("id"),

    CONSTRAINT "PosRefundAttempt_amount_check"
        CHECK ("amount" > 0),

    CONSTRAINT "PosRefundAttempt_method_check"
        CHECK ("method" IN ('CASH','CARD','OTHER')),

    CONSTRAINT "PosRefundAttempt_state_check"
        CHECK (
            (
                "status" = 'REGISTERED'
                AND "paymentState" = 'UNCONFIRMED'
                AND "settlementId" IS NULL
            )
            OR
            (
                "status" = 'PAYMENT_AUTHORIZED'
                AND "paymentState" = 'UNKNOWN'
                AND "settlementId" IS NULL
            )
            OR
            (
                "status" = 'PAID'
                AND "paymentState" = 'CONFIRMED'
                AND "settlementId" IS NULL
            )
            OR
            (
                "status" = 'ACCEPTED'
                AND "paymentState" = 'CONFIRMED'
                AND "settlementId" IS NOT NULL
            )
            OR
            (
                "status" = 'RESOLVED_NO_PAYMENT'
                AND "paymentState" = 'NOT_PAID'
                AND "settlementId" IS NULL
                AND "resolvedById" IS NOT NULL
                AND "resolvedAt" IS NOT NULL
                AND "resolutionReason" IS NOT NULL
            )
        )
);

CREATE UNIQUE INDEX "PosRefundAttempt_settlementId_key"
ON "PosRefundAttempt"("settlementId");

CREATE INDEX "PosRefundAttempt_returnId_status_idx"
ON "PosRefundAttempt"("returnId","status");

CREATE INDEX "PosRefundAttempt_locationId_status_idx"
ON "PosRefundAttempt"("locationId","status");

CREATE INDEX "PosRefundAttempt_shiftId_status_idx"
ON "PosRefundAttempt"("shiftId","status");

CREATE INDEX "PosRefundAttempt_deviceId_status_idx"
ON "PosRefundAttempt"("deviceId","status");

CREATE UNIQUE INDEX "PosRefundAttempt_one_pending_return"
ON "PosRefundAttempt"("returnId")
WHERE "status" NOT IN ('ACCEPTED','RESOLVED_NO_PAYMENT');

CREATE UNIQUE INDEX "PosRefundAttempt_one_pending_device"
ON "PosRefundAttempt"("deviceId")
WHERE "status" NOT IN ('ACCEPTED','RESOLVED_NO_PAYMENT');

ALTER TABLE "PosRefundAttempt"
ADD CONSTRAINT "PosRefundAttempt_return_fk"
FOREIGN KEY ("returnId")
REFERENCES "PosReturn"("id")
ON DELETE RESTRICT;

ALTER TABLE "PosRefundAttempt"
ADD CONSTRAINT "PosRefundAttempt_settlement_fk"
FOREIGN KEY ("settlementId")
REFERENCES "PosRefundSettlement"("id")
ON DELETE RESTRICT;
