BEGIN;

ALTER TABLE "PosExchangeAttempt"
 ADD COLUMN "reversalStatus" TEXT NOT NULL DEFAULT 'NONE',
 ADD COLUMN "reversalRequestedById" UUID,
 ADD COLUMN "reversalRequestedAt" TIMESTAMP(3),
 ADD COLUMN "reversalRequestReason" VARCHAR(500),
 ADD COLUMN "reversalApprovedById" UUID,
 ADD COLUMN "reversalApprovedAt" TIMESTAMP(3),
 ADD COLUMN "reversalConfirmedById" UUID,
 ADD COLUMN "reversalConfirmedAt" TIMESTAMP(3),
 ADD COLUMN "reversalEvidenceReference" VARCHAR(200);

ALTER TABLE "PosExchangeAttempt"
 ADD CONSTRAINT "r103d24_exchange_reversal_status"
 CHECK (
  "reversalStatus" IN (
   'NONE',
   'REQUESTED',
   'AUTHORIZED',
   'CONFIRMED'
  )
 ),

 ADD CONSTRAINT "r103d24_exchange_reversal_requester_fk"
 FOREIGN KEY ("reversalRequestedById")
 REFERENCES "User"("id")
 ON DELETE RESTRICT,

 ADD CONSTRAINT "r103d24_exchange_reversal_approver_fk"
 FOREIGN KEY ("reversalApprovedById")
 REFERENCES "User"("id")
 ON DELETE RESTRICT,

 ADD CONSTRAINT "r103d24_exchange_reversal_confirmer_fk"
 FOREIGN KEY ("reversalConfirmedById")
 REFERENCES "User"("id")
 ON DELETE RESTRICT,

 ADD CONSTRAINT "r103d24_exchange_independent_approval"
 CHECK (
  "reversalApprovedById" IS NULL
  OR (
   "reversalRequestedById" IS NOT NULL
   AND "reversalApprovedById" <> "reversalRequestedById"
  )
 ),

 ADD CONSTRAINT "r103d24_exchange_reversal_request_evidence"
 CHECK (
  "reversalStatus" = 'NONE'
  OR (
   "reversalRequestedById" IS NOT NULL
   AND "reversalRequestedAt" IS NOT NULL
   AND "reversalRequestReason" IS NOT NULL
   AND length(trim("reversalRequestReason")) >= 10
  )
 ),

 ADD CONSTRAINT "r103d24_exchange_reversal_approval_evidence"
 CHECK (
  "reversalStatus" NOT IN ('AUTHORIZED','CONFIRMED')
  OR (
   "reversalApprovedById" IS NOT NULL
   AND "reversalApprovedAt" IS NOT NULL
   AND "reversalApprovedAt" >= "reversalRequestedAt"
  )
 ),

 ADD CONSTRAINT "r103d24_exchange_reversal_confirmation_evidence"
 CHECK (
  "reversalStatus" <> 'CONFIRMED'
  OR (
   "reversalConfirmedById" IS NOT NULL
   AND "reversalConfirmedAt" IS NOT NULL
   AND "reversalConfirmedAt" >= "reversalApprovedAt"
   AND "reversalEvidenceReference" IS NOT NULL
   AND length(trim("reversalEvidenceReference")) >= 5
  )
 ),

 ADD CONSTRAINT "r103d24_exchange_reversal_completion_exclusion"
 CHECK (
  "reversalStatus" = 'NONE'
  OR "status" <> 'ACCEPTED'
 );

CREATE INDEX
 "PosExchangeAttempt_locationId_reversalStatus_idx"
 ON "PosExchangeAttempt"(
  "locationId",
  "reversalStatus"
 );

COMMIT;