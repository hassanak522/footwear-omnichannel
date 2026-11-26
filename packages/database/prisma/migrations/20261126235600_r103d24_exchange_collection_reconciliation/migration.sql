BEGIN;

ALTER TABLE "PosExchangeAttempt"
 DROP CONSTRAINT "r103d24_exchange_payment_sequence";

ALTER TABLE "PosExchangeAttempt"
 ADD CONSTRAINT "r103d24_exchange_payment_sequence"
 CHECK (
  "paymentConfirmedAt" IS NULL
  OR (
   "paymentAuthorizedAt" IS NOT NULL
   AND "paymentConfirmedAt">="paymentAuthorizedAt"
   AND "paymentConfirmedById" IS NOT NULL
  )
 );

CREATE OR REPLACE FUNCTION r103d24_exchange_collection_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF TG_OP='INSERT' THEN

  IF NEW."paymentAuthorizedById" IS NOT NULL
   OR NEW."paymentAuthorizedAt" IS NOT NULL
   OR NEW."paymentConfirmedById" IS NOT NULL
   OR NEW."paymentConfirmedAt" IS NOT NULL
   OR NEW."status"<>'REGISTERED'
   OR NEW."paymentState" NOT IN (
    'UNCONFIRMED','NO_PAYMENT_REQUIRED'
   )
  THEN
   RAISE EXCEPTION 'Invalid initial exchange payment state';
  END IF;

  RETURN NEW;
 END IF;

 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Exchange attempt history cannot be deleted';
 END IF;

 IF ROW(
  OLD."id",
  OLD."originalSaleId",
  OLD."locationId",
  OLD."deviceId",
  OLD."shiftId",
  OLD."registeredById",
  OLD."payloadHash",
  OLD."payload",
  OLD."createdAt"
 ) IS DISTINCT FROM ROW(
  NEW."id",
  NEW."originalSaleId",
  NEW."locationId",
  NEW."deviceId",
  NEW."shiftId",
  NEW."registeredById",
  NEW."payloadHash",
  NEW."payload",
  NEW."createdAt"
 ) THEN
  RAISE EXCEPTION 'Exchange attempt identity is immutable';
 END IF;

 IF OLD."status" IN (
  'ACCEPTED','RESOLVED_NO_EXCHANGE'
 ) AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'Finalized exchange history is immutable';
 END IF;

 IF OLD."paymentAuthorizedAt" IS NOT NULL
  AND ROW(
   OLD."paymentAuthorizedById",
   OLD."paymentAuthorizedAt"
  ) IS DISTINCT FROM ROW(
   NEW."paymentAuthorizedById",
   NEW."paymentAuthorizedAt"
  )
 THEN
  RAISE EXCEPTION 'Payment authorization is immutable';
 END IF;

 IF OLD."paymentAuthorizedAt" IS NULL
  AND NEW."paymentAuthorizedAt" IS NOT NULL
 THEN

  IF OLD."status"<>'REGISTERED'
   OR NEW."status"<>'REGISTERED'
   OR OLD."paymentState"<>'UNCONFIRMED'
   OR NEW."paymentState"<>'UNCONFIRMED'
   OR OLD."reversalStatus"<>'NONE'
   OR NEW."reversalStatus"<>'NONE'
  THEN
   RAISE EXCEPTION 'Invalid collection authorization transition';
  END IF;

 END IF;

 IF OLD."paymentConfirmedAt" IS NOT NULL
  AND ROW(
   OLD."paymentConfirmedById",
   OLD."paymentConfirmedAt"
  ) IS DISTINCT FROM ROW(
   NEW."paymentConfirmedById",
   NEW."paymentConfirmedAt"
  )
 THEN
  RAISE EXCEPTION 'Payment confirmation is immutable';
 END IF;

 IF OLD."paymentConfirmedAt" IS NULL
  AND NEW."paymentConfirmedAt" IS NOT NULL
  AND NOT (
   OLD."paymentState"='UNCONFIRMED'
   AND NEW."paymentState"='CONFIRMED'
  )
 THEN
  RAISE EXCEPTION 'Invalid payment confirmation evidence';
 END IF;

 IF OLD."paymentState" IS DISTINCT FROM NEW."paymentState"
  AND NEW."paymentState"='CONFIRMED'
 THEN

  IF OLD."paymentState"<>'UNCONFIRMED'
   OR OLD."paymentAuthorizedAt" IS NULL
   OR NEW."paymentConfirmedAt" IS NULL

   OR OLD."reversalStatus"<>'NONE'
   OR NEW."reversalStatus"<>'NONE'
  THEN
   RAISE EXCEPTION 'Exclusive payment authorization required';
  END IF;

 END IF;


 -- R10_3D24C_EXCHANGE_COLLECTION_RECONCILIATION

 IF EXISTS (
  SELECT 1
  FROM "PosPaymentReconciliation" c
  WHERE c."exchangeAttemptId"=OLD."id"
   AND c."status"='PENDING'
 ) THEN
  RAISE EXCEPTION
   'Pending investigation prevents exchange state changes';
 END IF;

 IF OLD."paymentState"='UNCONFIRMED'
  AND NEW."paymentState"='CONFIRMED'
  AND NEW."paymentConfirmedById"
      IS DISTINCT FROM OLD."paymentAuthorizedById"
 THEN

  IF NOT EXISTS (
   SELECT 1
   FROM "PosPaymentReconciliation" c
   WHERE c."exchangeAttemptId"=OLD."id"
    AND c."kind"='EXCHANGE_COLLECTION'
    AND c."status"='APPROVED'
    AND c."proposedOutcome"='COLLECTED'
    AND c."paymentOperatorId"=OLD."paymentAuthorizedById"
    AND c."payloadHash"=OLD."payloadHash"
    AND c."locationId"=OLD."locationId"
    AND c."deviceId"=OLD."deviceId"
    AND c."shiftId"=OLD."shiftId"
    AND c."originalStatus"=OLD."status"
    AND c."originalPaymentState"=OLD."paymentState"
    AND c."originalReversalStatus"=OLD."reversalStatus"
    AND c."reviewedById"=NEW."paymentConfirmedById"
    AND c."reviewedAt"=NEW."paymentConfirmedAt"
  ) THEN
   RAISE EXCEPTION
    'Independent collection investigation required';
  END IF;

 END IF;

 IF NEW."paymentState"='NOT_COLLECTED'
  AND OLD."paymentState"<>'NOT_COLLECTED'
 THEN

  IF OLD."paymentState"<>'UNCONFIRMED'
   OR OLD."reversalStatus"<>'NONE'
   OR NEW."reversalStatus"<>'NONE'
   OR NEW."status"<>'RESOLVED_NO_EXCHANGE'
   OR OLD."paymentAuthorizedAt" IS NULL
   OR NOT EXISTS (
    SELECT 1
    FROM "PosPaymentReconciliation" c
    WHERE c."exchangeAttemptId"=OLD."id"
     AND c."kind"='EXCHANGE_COLLECTION'
     AND c."status"='APPROVED'
     AND c."proposedOutcome"='NOT_COLLECTED'
     AND c."executionAbandoned"=true
     AND c."submittedById"=OLD."paymentAuthorizedById"
     AND c."paymentOperatorId"=OLD."paymentAuthorizedById"
     AND c."payloadHash"=OLD."payloadHash"
     AND c."locationId"=OLD."locationId"
     AND c."deviceId"=OLD."deviceId"
     AND c."shiftId"=OLD."shiftId"
     AND c."originalStatus"=OLD."status"
     AND c."originalPaymentState"=OLD."paymentState"
     AND c."originalReversalStatus"=OLD."reversalStatus"
     AND c."reviewedById"=NEW."resolvedById"
     AND c."reviewedAt"=NEW."resolvedAt"
     AND c."reason"=NEW."resolutionReason"
   )
  THEN
   RAISE EXCEPTION
    'Approved uncollected payment investigation required';
  END IF;

 END IF;

 IF NEW."status"='ACCEPTED'
  AND OLD."status"<>'ACCEPTED'
 THEN

  IF NEW."reversalStatus"<>'NONE'
   OR NEW."paymentState" NOT IN (
    'CONFIRMED','NO_PAYMENT_REQUIRED'
   )
   OR (
    NEW."paymentState"='CONFIRMED'
    AND (
     NEW."paymentAuthorizedAt" IS NULL
     OR NEW."paymentConfirmedAt" IS NULL
    )
   )
  THEN
   RAISE EXCEPTION 'Exchange payment integrity not established';
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