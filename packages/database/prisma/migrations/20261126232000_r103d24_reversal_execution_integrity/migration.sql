BEGIN;

ALTER TABLE "PosExchangeAttempt"
 ADD COLUMN "reversalExecutionById" UUID,
 ADD COLUMN "reversalExecutionAt" TIMESTAMP(3);

ALTER TABLE "PosExchangeAttempt"
 ADD CONSTRAINT "r103d24_reversal_execution_operator_fk"
 FOREIGN KEY ("reversalExecutionById")
 REFERENCES "User"("id") ON DELETE RESTRICT,

 ADD CONSTRAINT "r103d24_reversal_execution_pair"
 CHECK (
  ("reversalExecutionById" IS NULL)
  =
  ("reversalExecutionAt" IS NULL)
 ),

 ADD CONSTRAINT "r103d24_reversal_execution_sequence"
 CHECK (
  "reversalExecutionAt" IS NULL
  OR (
   "reversalStatus" IN ('AUTHORIZED','CONFIRMED')
   AND "reversalApprovedAt" IS NOT NULL
   AND "reversalExecutionAt">="reversalApprovedAt"
   AND "reversalExecutionById"="reversalRequestedById"
   AND "reversalExecutionById"<>"reversalApprovedById"
   AND "reversalApprovalEvidence" IS NOT NULL
   AND length(trim("reversalApprovalEvidence"))>=5
  )
 );

CREATE OR REPLACE FUNCTION r103d24_reversal_execution_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF TG_OP='INSERT' THEN

  IF NEW."reversalStatus"<>'NONE'
   OR NEW."reversalRequestedById" IS NOT NULL
   OR NEW."reversalRequestedAt" IS NOT NULL
   OR NEW."reversalRequestReason" IS NOT NULL
   OR NEW."reversalApprovedById" IS NOT NULL
   OR NEW."reversalApprovedAt" IS NOT NULL
   OR NEW."reversalApprovalEvidence" IS NOT NULL
   OR NEW."reversalExecutionById" IS NOT NULL
   OR NEW."reversalExecutionAt" IS NOT NULL
   OR NEW."reversalConfirmedById" IS NOT NULL
   OR NEW."reversalConfirmedAt" IS NOT NULL
   OR NEW."reversalEvidenceReference" IS NOT NULL
  THEN
   RAISE EXCEPTION 'Invalid initial reversal state';
  END IF;

  RETURN NEW;
 END IF;

 IF OLD."reversalStatus" IS DISTINCT FROM NEW."reversalStatus"
  AND NOT (
   (OLD."reversalStatus"='NONE'
    AND NEW."reversalStatus"='REQUESTED')
   OR
   (OLD."reversalStatus"='REQUESTED'
    AND NEW."reversalStatus"='AUTHORIZED')
   OR
   (OLD."reversalStatus"='AUTHORIZED'
    AND NEW."reversalStatus"='CONFIRMED')
  )
 THEN
  RAISE EXCEPTION 'Invalid reversal state transition';
 END IF;

 IF ROW(
  OLD."reversalRequestedById",
  OLD."reversalRequestedAt",
  OLD."reversalRequestReason"
 ) IS DISTINCT FROM ROW(
  NEW."reversalRequestedById",
  NEW."reversalRequestedAt",
  NEW."reversalRequestReason"
 ) AND NOT (
  OLD."reversalStatus"='NONE'
  AND NEW."reversalStatus"='REQUESTED'
 ) THEN
  RAISE EXCEPTION 'Reversal request evidence is immutable';
 END IF;

 IF ROW(
  OLD."reversalApprovedById",
  OLD."reversalApprovedAt",
  OLD."reversalApprovalEvidence"
 ) IS DISTINCT FROM ROW(
  NEW."reversalApprovedById",
  NEW."reversalApprovedAt",
  NEW."reversalApprovalEvidence"
 ) AND NOT (
  OLD."reversalStatus"='REQUESTED'
  AND NEW."reversalStatus"='AUTHORIZED'
 ) THEN
  RAISE EXCEPTION 'Reversal approval evidence is immutable';
 END IF;

 IF ROW(
  OLD."reversalExecutionById",
  OLD."reversalExecutionAt"
 ) IS DISTINCT FROM ROW(
  NEW."reversalExecutionById",
  NEW."reversalExecutionAt"
 ) AND NOT (
  OLD."reversalStatus"='AUTHORIZED'
  AND NEW."reversalStatus"='AUTHORIZED'
  AND OLD."reversalExecutionAt" IS NULL
  AND NEW."reversalExecutionAt" IS NOT NULL
 ) THEN
  RAISE EXCEPTION 'Reversal execution claim is immutable';
 END IF;

 IF ROW(
  OLD."reversalConfirmedById",
  OLD."reversalConfirmedAt",
  OLD."reversalEvidenceReference"
 ) IS DISTINCT FROM ROW(
  NEW."reversalConfirmedById",
  NEW."reversalConfirmedAt",
  NEW."reversalEvidenceReference"
 ) AND NOT (
  OLD."reversalStatus"='AUTHORIZED'
  AND NEW."reversalStatus"='CONFIRMED'
 ) THEN
  RAISE EXCEPTION 'Reversal confirmation evidence is immutable';
 END IF;

 IF OLD."reversalStatus"='NONE'
  AND NEW."reversalStatus"='REQUESTED'
 THEN

  IF OLD."status" NOT IN ('REGISTERED','UNKNOWN')
   OR OLD."paymentState" NOT IN ('UNCONFIRMED','CONFIRMED')
   OR OLD."paymentAuthorizedById" IS NULL
   OR NEW."reversalRequestedById"
      IS DISTINCT FROM OLD."paymentAuthorizedById"
  THEN
   RAISE EXCEPTION 'Original payment operator request required';
  END IF;

 END IF;

 IF NEW."reversalStatus" IN ('AUTHORIZED','CONFIRMED')
 THEN

  IF NEW."reversalApprovalEvidence" IS NULL
   OR length(trim(NEW."reversalApprovalEvidence"))<5
   OR NEW."reversalApprovedById"
      IS NOT DISTINCT FROM NEW."paymentAuthorizedById"
  THEN
   RAISE EXCEPTION 'Independent approval evidence required';
  END IF;

 END IF;

 IF NEW."reversalStatus"='CONFIRMED'
 THEN

  IF NEW."reversalExecutionAt" IS NULL
   OR NEW."reversalConfirmedAt" IS NULL
   OR NEW."reversalConfirmedAt"<NEW."reversalExecutionAt"
   OR NEW."reversalConfirmedById"
      IS DISTINCT FROM NEW."reversalExecutionById"
  THEN
   RAISE EXCEPTION 'Verified reversal execution required';
  END IF;

 END IF;

 IF OLD."reversalStatus"<>'NONE'
  AND NEW."paymentState" IS DISTINCT FROM OLD."paymentState"
  AND NOT (
   NEW."status"='RESOLVED_NO_EXCHANGE'
   AND NEW."paymentState"='REVERSED'
   AND NEW."reversalStatus"='CONFIRMED'
  )
 THEN
  RAISE EXCEPTION 'Active reversal excludes other payment transitions';
 END IF;

 IF NEW."status"='RESOLVED_NO_EXCHANGE'
  AND OLD."status"<>'RESOLVED_NO_EXCHANGE'
 THEN

  IF NEW."paymentState"='REVERSED'
  THEN

   IF NEW."reversalStatus"<>'CONFIRMED'
    OR NEW."reversalExecutionAt" IS NULL
    OR NEW."resolvedById" IS NULL
    OR NEW."resolvedById"=NEW."reversalExecutionById"
   THEN
    RAISE EXCEPTION 'Independent reversal finalization required';
   END IF;

  ELSIF NEW."paymentState"='NO_PAYMENT_REQUIRED'
  THEN

   IF OLD."paymentState"<>'NO_PAYMENT_REQUIRED'
    OR OLD."paymentAuthorizedAt" IS NOT NULL
    OR NEW."reversalStatus"<>'NONE'
   THEN
    RAISE EXCEPTION 'Invalid zero-payment cancellation';
   END IF;

  ELSE
   RAISE EXCEPTION 'Dedicated payment reconciliation required';
  END IF;

 END IF;

 RETURN NEW;
END;
$$;

CREATE TRIGGER r103d24_reversal_execution_integrity
 BEFORE INSERT OR UPDATE
 ON "PosExchangeAttempt"
 FOR EACH ROW
 EXECUTE FUNCTION r103d24_reversal_execution_guard();

COMMIT;