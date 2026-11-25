CREATE TABLE "PosExchangeAttempt" (
 "id" UUID NOT NULL,
 "originalSaleId" UUID NOT NULL,
 "deviceId" UUID NOT NULL,
 "shiftId" UUID NOT NULL,
 "locationId" UUID NOT NULL,
 "registeredById" UUID NOT NULL,
 "payloadHash" TEXT NOT NULL,
 "payload" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'REGISTERED',
 "paymentState" TEXT NOT NULL DEFAULT 'UNCONFIRMED',
 "resolutionReason" TEXT,
 "resolvedById" UUID,
 "resolvedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,

 CONSTRAINT "PosExchangeAttempt_pkey"
 PRIMARY KEY ("id"),

 CONSTRAINT "PosExchangeAttempt_status_check"
 CHECK ("status" IN (
  'REGISTERED',
  'UNKNOWN',
  'ACCEPTED',
  'RESOLVED_NO_EXCHANGE'
 )),

 CONSTRAINT "PosExchangeAttempt_payment_check"
 CHECK ("paymentState" IN (
  'UNCONFIRMED',
  'CONFIRMED',
  'NO_PAYMENT_REQUIRED',
  'REVERSED',
  'NOT_COLLECTED'
 )),

 CONSTRAINT "PosExchangeAttempt_resolution_check"
 CHECK (
  "status"<>'RESOLVED_NO_EXCHANGE'
  OR (
   "resolvedById" IS NOT NULL
   AND "resolvedAt" IS NOT NULL
   AND "resolutionReason" IS NOT NULL
   AND "paymentState" IN (
    'REVERSED','NOT_COLLECTED','NO_PAYMENT_REQUIRED'
   )
  )
 )
);

CREATE INDEX "PosExchangeAttempt_shiftId_status_idx"
 ON "PosExchangeAttempt"("shiftId","status");

CREATE INDEX "PosExchangeAttempt_locationId_status_idx"
 ON "PosExchangeAttempt"("locationId","status");

CREATE INDEX "PosExchangeAttempt_deviceId_status_idx"
 ON "PosExchangeAttempt"("deviceId","status");