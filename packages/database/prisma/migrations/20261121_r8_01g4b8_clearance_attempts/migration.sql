CREATE TABLE "PosClearanceAttempt" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "localSaleId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosClearanceAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosClearanceAttempt_deviceId_localSaleId_key"
ON "PosClearanceAttempt"("deviceId","localSaleId");

CREATE INDEX "PosClearanceAttempt_shiftId_status_idx"
ON "PosClearanceAttempt"("shiftId","status");

CREATE INDEX "PosClearanceAttempt_locationId_createdAt_idx"
ON "PosClearanceAttempt"("locationId","createdAt");

ALTER TABLE "PosClearanceAttempt"
ADD CONSTRAINT "PosClearanceAttempt_status_check"
CHECK ("status" IN ('REGISTERED','ACCEPTED','REVIEW_REQUIRED'));
