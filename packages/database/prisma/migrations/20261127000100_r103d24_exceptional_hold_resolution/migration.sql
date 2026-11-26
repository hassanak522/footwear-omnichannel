BEGIN;

-- R10_3D24C_EXCEPTIONAL_HQ_HOLD_RESOLUTION
--
-- Preserve original payment abandonment.
-- Permit independently verified reversal evidence.
-- Never restore physical execution authority.
-- Preserve existing triggers and historical records.

CREATE OR REPLACE FUNCTION r103d24_exchange_investigation_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
 a "PosExchangeAttempt"%ROWTYPE;
 expected_amount numeric;
 operator_id uuid;
BEGIN

 IF NEW."kind" NOT IN (
  'EXCHANGE_COLLECTION',
  'EXCHANGE_REVERSAL'
 ) THEN
  RETURN NEW;
 END IF;

 SELECT * INTO a
 FROM "PosExchangeAttempt"
 WHERE "id"=NEW."exchangeAttemptId"
 FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'Exchange investigation attempt missing';
 END IF;

 IF a."status" NOT IN ('REGISTERED','UNKNOWN')
  OR a."locationId" IS DISTINCT FROM NEW."locationId"
  OR a."deviceId" IS DISTINCT FROM NEW."deviceId"
  OR a."shiftId" IS DISTINCT FROM NEW."shiftId"
  OR a."payloadHash" IS DISTINCT FROM NEW."payloadHash"
  OR a."status" IS DISTINCT FROM NEW."originalStatus"
  OR a."paymentState" IS DISTINCT FROM NEW."originalPaymentState"
  OR a."reversalStatus" IS DISTINCT FROM NEW."originalReversalStatus"
 THEN
  RAISE EXCEPTION 'Exchange investigation identity mismatch';
 END IF;

 expected_amount :=
  (a."payload"->>'expectedReplacementValue')::numeric
  -
  (a."payload"->>'expectedReturnValue')::numeric;

 IF expected_amount IS NULL
  OR expected_amount<=0
  OR expected_amount IS DISTINCT FROM NEW."amount"
 THEN
  RAISE EXCEPTION 'Exchange investigation amount mismatch';
 END IF;

 IF NEW."kind"='EXCHANGE_COLLECTION' THEN

  IF a."paymentState"<>'UNCONFIRMED'
   OR a."reversalStatus"<>'NONE'
   OR a."paymentAuthorizedAt" IS NULL
   OR a."paymentAuthorizedById" IS NULL
   OR a."paymentConfirmedAt" IS NOT NULL
   OR NEW."proposedOutcome" NOT IN (
    'COLLECTED','NOT_COLLECTED'
   )
  THEN
   RAISE EXCEPTION 'Collection investigation not eligible';
  END IF;

  operator_id := a."paymentAuthorizedById";

 ELSE

  IF a."paymentState"<>'CONFIRMED'
   OR a."reversalStatus"<>'AUTHORIZED'
   OR a."reversalExecutionAt" IS NULL
   OR a."reversalExecutionById" IS NULL
   OR a."reversalConfirmedAt" IS NOT NULL
   OR NEW."proposedOutcome" NOT IN (
    'REVERSED','NOT_REVERSED'
   )
  THEN
   RAISE EXCEPTION 'Reversal investigation not eligible';
  END IF;

 
  -- R10_3D24C_ABANDONED_REVERSAL_INVESTIGATION_HOLD

  -- R10_3D24C_EXCEPTIONAL_HOLD_IDENTITY_GUARD

  IF TG_OP='INSERT' AND EXISTS (
   SELECT 1
   FROM "PosPaymentReconciliation" c
   WHERE c."exchangeAttemptId"=a."id"
    AND c."kind"='EXCHANGE_REVERSAL'
    AND c."status"='APPROVED'
    AND c."proposedOutcome"='NOT_REVERSED'
  ) AND (
   NEW."proposedOutcome"<>'REVERSED'
   OR NEW."executionAbandoned" IS DISTINCT FROM false
   OR NEW."submittedById"=a."reversalExecutionById"
   OR EXISTS (
    SELECT 1
    FROM "PosPaymentReconciliation" h
    WHERE h."exchangeAttemptId"=a."id"
     AND h."kind"='EXCHANGE_REVERSAL'
     AND h."status"='APPROVED'
     AND h."proposedOutcome"='NOT_REVERSED'
     AND h."reviewedAt">=NEW."submittedAt"
   )
  ) THEN
   RAISE EXCEPTION
    'Financial hold permits independent positive reversal evidence only';
  END IF;

 operator_id := a."reversalExecutionById";

 END IF;

 IF operator_id IS DISTINCT FROM NEW."paymentOperatorId"
 THEN
  RAISE EXCEPTION 'Investigation payment operator mismatch';
 END IF;

 IF NEW."proposedOutcome" IN (
  'NOT_COLLECTED','NOT_REVERSED'
 ) THEN

  IF NEW."executionAbandoned" IS DISTINCT FROM true
   OR NEW."submittedById" IS DISTINCT FROM operator_id
  THEN
   RAISE EXCEPTION 'Original operator abandonment required';
  END IF;

 END IF;

 RETURN NEW;

END;
$$;

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

 -- R10_3D24C_EXCEPTIONAL_HOLD_TRANSITION_GUARD
 -- Historical abandonment remains immutable.
 -- Only verified independent evidence may release the hold.

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
 AND NOT (
  OLD."reversalExecutionById" IS NOT NULL
  AND OLD."reversalExecutionAt" IS NOT NULL
  AND OLD."reversalExecutionById"
      IS NOT DISTINCT FROM NEW."reversalExecutionById"
  AND OLD."reversalExecutionAt"
      IS NOT DISTINCT FROM NEW."reversalExecutionAt"
  AND (
   (
    OLD."reversalStatus"='AUTHORIZED'
    AND NEW."reversalStatus"='CONFIRMED'
    AND OLD."status" IN ('REGISTERED','UNKNOWN')
    AND OLD."status"=NEW."status"
    AND OLD."paymentState"='CONFIRMED'
    AND NEW."paymentState"='CONFIRMED'
   )
   OR
   (
    OLD."reversalStatus"='CONFIRMED'
    AND NEW."reversalStatus"='CONFIRMED'
    AND OLD."status" IN ('REGISTERED','UNKNOWN')
    AND NEW."status"='RESOLVED_NO_EXCHANGE'
    AND OLD."paymentState"='CONFIRMED'
    AND NEW."paymentState"='REVERSED'
    AND NEW."resolvedById" IS NOT NULL
    AND NEW."resolvedById"<>OLD."reversalExecutionById"
    AND NEW."resolvedById"<>NEW."reversalConfirmedById"
   )
  )
  AND EXISTS (
   SELECT 1
   FROM "PosPaymentReconciliation" p
   WHERE p."exchangeAttemptId"=OLD."id"
    AND p."kind"='EXCHANGE_REVERSAL'
    AND p."status"='APPROVED'
    AND p."proposedOutcome"='REVERSED'
    AND p."executionAbandoned"=false
    AND p."paymentOperatorId"=OLD."reversalExecutionById"
    AND p."submittedById"<>OLD."reversalExecutionById"
    AND p."reviewedById"<>p."submittedById"
    AND p."reviewedById"<>OLD."reversalExecutionById"
    AND p."reviewedById"=NEW."reversalConfirmedById"
    AND p."reviewedAt"=NEW."reversalConfirmedAt"
    AND p."evidenceReference"=NEW."reversalEvidenceReference"
    AND p."payloadHash"=OLD."payloadHash"
    AND p."locationId"=OLD."locationId"
    AND p."deviceId"=OLD."deviceId"
    AND p."shiftId"=OLD."shiftId"
    AND p."originalStatus"=OLD."status"
    AND p."originalPaymentState"='CONFIRMED'
    AND p."originalReversalStatus"='AUTHORIZED'
    AND NOT EXISTS (
     SELECT 1
     FROM "PosPaymentReconciliation" h
     WHERE h."exchangeAttemptId"=OLD."id"
      AND h."kind"='EXCHANGE_REVERSAL'
      AND h."status"='APPROVED'
      AND h."proposedOutcome"='NOT_REVERSED'
      AND h."reviewedAt">=p."submittedAt"
    )
  )
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
