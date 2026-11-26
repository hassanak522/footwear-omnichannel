BEGIN;

ALTER TABLE "PosExchangeAttempt"
 ADD COLUMN "paymentAuthorizedById" UUID,
 ADD COLUMN "paymentAuthorizedAt" TIMESTAMP(3),
 ADD COLUMN "paymentConfirmedById" UUID,
 ADD COLUMN "paymentConfirmedAt" TIMESTAMP(3),
 ADD COLUMN "reversalApprovalEvidence" VARCHAR(200);

ALTER TABLE "PosExchangeAttempt"
 ADD CONSTRAINT "r103d24_exchange_payment_authorizer_fk"
 FOREIGN KEY ("paymentAuthorizedById")
 REFERENCES "User"("id") ON DELETE RESTRICT,

 ADD CONSTRAINT "r103d24_exchange_payment_confirmer_fk"
 FOREIGN KEY ("paymentConfirmedById")
 REFERENCES "User"("id") ON DELETE RESTRICT,

 ADD CONSTRAINT "r103d24_exchange_authorization_pair"
 CHECK (
  ("paymentAuthorizedById" IS NULL)
  =
  ("paymentAuthorizedAt" IS NULL)
 ),

 ADD CONSTRAINT "r103d24_exchange_confirmation_pair"
 CHECK (
  ("paymentConfirmedById" IS NULL)
  =
  ("paymentConfirmedAt" IS NULL)
 ),

 ADD CONSTRAINT "r103d24_exchange_payment_sequence"
 CHECK (
  "paymentConfirmedAt" IS NULL
  OR (
   "paymentAuthorizedAt" IS NOT NULL
   AND "paymentConfirmedAt">="paymentAuthorizedAt"
   AND "paymentConfirmedById"="paymentAuthorizedById"
  )
 );

CREATE UNIQUE INDEX "r103d24_one_pending_exchange_per_device"
 ON "PosExchangeAttempt"("deviceId")
 WHERE "status" NOT IN (
  'ACCEPTED','RESOLVED_NO_EXCHANGE'
 );

COMMIT;