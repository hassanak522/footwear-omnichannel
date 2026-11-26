BEGIN;

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
  THEN
   RAISE EXCEPTION 'Verified reversal execution required';
  END IF;

 END IF;


 -- R10_3D24C_INDEPENDENT_REVERSAL_RECONCILIATION

 IF OLD."reversalStatus"='AUTHORIZED'
  AND NEW."reversalStatus"='CONFIRMED'
 THEN

  IF OLD."paymentState"<>'CONFIRMED'
   OR OLD."reversalExecutionById" IS NULL
   OR OLD."reversalExecutionAt" IS NULL
   OR NEW."reversalConfirmedById" IS NULL
   OR NEW."reversalEvidenceReference" IS NULL
   OR length(trim(NEW."reversalEvidenceReference"))<5
  THEN
   RAISE EXCEPTION
    'Existing reversal execution evidence required';
  END IF;

  IF NEW."reversalConfirmedById"
     IS DISTINCT FROM OLD."reversalExecutionById"
  THEN

   IF NOT EXISTS (
    SELECT 1
    FROM "PosPaymentReconciliation" c
    WHERE c."exchangeAttemptId"=OLD."id"
     AND c."kind"='EXCHANGE_REVERSAL'
     AND c."status"='APPROVED'
     AND c."proposedOutcome"='REVERSED'
     AND c."paymentOperatorId"=OLD."reversalExecutionById"
     AND c."payloadHash"=OLD."payloadHash"
     AND c."locationId"=OLD."locationId"
     AND c."deviceId"=OLD."deviceId"
     AND c."shiftId"=OLD."shiftId"
     AND c."originalStatus"=OLD."status"
     AND c."originalPaymentState"=OLD."paymentState"
     AND c."originalReversalStatus"=OLD."reversalStatus"
     AND c."reviewedById"=NEW."reversalConfirmedById"
     AND c."reviewedAt"=NEW."reversalConfirmedAt"
     AND c."evidenceReference"=NEW."reversalEvidenceReference"
   ) THEN
    RAISE EXCEPTION
     'Approved independent reversal investigation required';
   END IF;

  END IF;

 END IF;

 IF OLD."reversalStatus"='NONE'
  AND NEW."reversalStatus"='REQUESTED'
  AND OLD."paymentState"<>'CONFIRMED'
 THEN
  RAISE EXCEPTION
   'Collection must be confirmed before reversal';
 END IF;

 -- Abandoned reversal remains financially blocked.

 IF EXISTS (
   SELECT 1
   FROM "PosPaymentReconciliation" c
   WHERE c."exchangeAttemptId"=OLD."id"
    AND c."kind"='EXCHANGE_REVERSAL'
    AND c."status"='APPROVED'
    AND c."proposedOutcome"='NOT_REVERSED'
 )
 AND (
  OLD."reversalStatus" IS DISTINCT FROM NEW."reversalStatus"
  OR OLD."paymentState" IS DISTINCT FROM NEW."paymentState"
  OR OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."reversalExecutionAt"
     IS DISTINCT FROM NEW."reversalExecutionAt"
  OR OLD."reversalExecutionById"
     IS DISTINCT FROM NEW."reversalExecutionById"
 )
 THEN
  RAISE EXCEPTION
   'Abandoned reversal remains under financial hold';
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
     OR NEW."resolvedById"=NEW."reversalConfirmedById"
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

  ELSIF NEW."paymentState"='NOT_COLLECTED'
  THEN

   IF OLD."paymentState"<>'UNCONFIRMED'
    OR OLD."reversalStatus"<>'NONE'
    OR NEW."reversalStatus"<>'NONE'
   THEN
    RAISE EXCEPTION 'Invalid uncollected exchange resolution';
   END IF;

  ELSE
   RAISE EXCEPTION 'Dedicated payment reconciliation required';
  END IF;

 END IF;

 RETURN NEW;
END;
$$;

COMMIT;
