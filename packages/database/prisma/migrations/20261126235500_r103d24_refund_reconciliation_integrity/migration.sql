BEGIN;

CREATE OR REPLACE FUNCTION
 r103d24_guard_refund_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION
   'Refund attempt history cannot be deleted';
 END IF;

 IF TG_OP = 'INSERT' THEN

  IF NEW."status" <> 'REGISTERED'
   OR NEW."paymentState" <> 'UNCONFIRMED'
   OR NEW."settlementId" IS NOT NULL
   OR NEW."authorizedById" IS NOT NULL
   OR NEW."authorizedAt" IS NOT NULL
   OR NEW."confirmedById" IS NOT NULL
   OR NEW."confirmedAt" IS NOT NULL
   OR NEW."evidenceReference" IS NOT NULL
   OR NEW."resolvedById" IS NOT NULL
   OR NEW."resolvedAt" IS NOT NULL
   OR NEW."resolutionReason" IS NOT NULL
  THEN
   RAISE EXCEPTION
    'Invalid initial refund attempt state';
  END IF;

  RETURN NEW;

 END IF;

 IF ROW(
  NEW."id",
  NEW."returnId",
  NEW."locationId",
  NEW."deviceId",
  NEW."shiftId",
  NEW."registeredById",
  NEW."amount",
  NEW."method",
  NEW."payload",
  NEW."payloadHash",
  NEW."createdAt"
 ) IS DISTINCT FROM ROW(
  OLD."id",
  OLD."returnId",
  OLD."locationId",
  OLD."deviceId",
  OLD."shiftId",
  OLD."registeredById",
  OLD."amount",
  OLD."method",
  OLD."payload",
  OLD."payloadHash",
  OLD."createdAt"
 ) THEN
  RAISE EXCEPTION
   'Registered refund identity and payload are immutable';
 END IF;

 IF OLD."status" IN (
  'ACCEPTED',
  'RESOLVED_NO_PAYMENT'
 ) THEN
  RAISE EXCEPTION
   'Finalized refund attempts are immutable';
 END IF;

 IF NOT (
  (
   OLD."status" = 'REGISTERED'
   AND NEW."status" IN (
    'PAYMENT_AUTHORIZED',
    'RESOLVED_NO_PAYMENT'
   )
  )
  OR
  (
   OLD."status" = 'PAYMENT_AUTHORIZED'
   AND NEW."status" IN ('PAID','RESOLVED_NO_PAYMENT')
  )
  OR
  (
   OLD."status" = 'PAID'
   AND NEW."status" = 'ACCEPTED'
  )
 ) THEN
  RAISE EXCEPTION
   'Invalid refund state transition: % to %',
   OLD."status",NEW."status";
 END IF;

 -- R10_3D24C_REFUND_RECONCILIATION_ENFORCEMENT

 IF EXISTS (
  SELECT 1 FROM "PosPaymentReconciliation" c
  WHERE c."refundAttemptId" = OLD."id"
   AND c."status" = 'PENDING'
 ) THEN
  RAISE EXCEPTION
   'Pending investigation prevents refund state changes';
 END IF;

 IF OLD."status" = 'PAYMENT_AUTHORIZED' THEN

  IF NEW."status" = 'RESOLVED_NO_PAYMENT' THEN

   IF NOT EXISTS (
    SELECT 1 FROM "PosPaymentReconciliation" c
    WHERE c."refundAttemptId" = OLD."id"
     AND c."kind" = 'REFUND_PAYOUT'
     AND c."status" = 'APPROVED'
     AND c."proposedOutcome" = 'NOT_PAID'
     AND c."executionAbandoned" = true
     AND c."submittedById" = OLD."authorizedById"
     AND c."paymentOperatorId" = OLD."authorizedById"
     AND c."payloadHash" = OLD."payloadHash"
     AND c."locationId" = OLD."locationId"
     AND c."deviceId" = OLD."deviceId"
     AND c."shiftId" = OLD."shiftId"
     AND c."amount" = OLD."amount"
     AND c."originalStatus" = OLD."status"
     AND c."originalPaymentState" = OLD."paymentState"
     AND c."reviewedById" = NEW."resolvedById"
     AND c."reviewedAt" = NEW."resolvedAt"
     AND c."evidenceReference" = NEW."evidenceReference"
     AND c."reason" = NEW."resolutionReason"
   ) THEN
    RAISE EXCEPTION
     'Approved independent unpaid refund investigation required';
   END IF;

  ELSIF NEW."status" = 'PAID' THEN

   IF NEW."confirmedById" IS DISTINCT FROM OLD."authorizedById"
   THEN

    IF NOT EXISTS (
     SELECT 1 FROM "PosPaymentReconciliation" c
     WHERE c."refundAttemptId" = OLD."id"
      AND c."kind" = 'REFUND_PAYOUT'
      AND c."status" = 'APPROVED'
      AND c."proposedOutcome" = 'PAID'
      AND c."paymentOperatorId" = OLD."authorizedById"
      AND c."payloadHash" = OLD."payloadHash"
      AND c."locationId" = OLD."locationId"
      AND c."deviceId" = OLD."deviceId"
      AND c."shiftId" = OLD."shiftId"
      AND c."amount" = OLD."amount"
      AND c."originalStatus" = OLD."status"
      AND c."originalPaymentState" = OLD."paymentState"
      AND c."reviewedById" = NEW."confirmedById"
      AND c."reviewedAt" = NEW."confirmedAt"
    ) THEN
     RAISE EXCEPTION
      'Independent paid refund investigation required';
    END IF;

   END IF;

  END IF;

 END IF;

 IF NEW."status" = 'PAYMENT_AUTHORIZED' THEN

  IF NEW."authorizedById" IS NULL
   OR NEW."authorizedAt" IS NULL
   OR NEW."confirmedById" IS NOT NULL
   OR NEW."confirmedAt" IS NOT NULL
  THEN
   RAISE EXCEPTION
    'Refund authorization accountability required';
  END IF;

 ELSE

  IF ROW(
   NEW."authorizedById",
   NEW."authorizedAt"
  ) IS DISTINCT FROM ROW(
   OLD."authorizedById",
   OLD."authorizedAt"
  ) THEN
   RAISE EXCEPTION
    'Refund authorization evidence is immutable';
  END IF;

 END IF;

 IF NEW."status" = 'PAID' THEN

  IF NEW."confirmedById" IS NULL
   OR NEW."confirmedAt" IS NULL
   OR NEW."authorizedById" IS NULL
   OR NEW."authorizedAt" IS NULL
   OR NEW."confirmedAt" < NEW."authorizedAt"
  THEN
   RAISE EXCEPTION
    'Refund confirmation accountability required';
  END IF;

 ELSE

  IF ROW(
   NEW."confirmedById",
   NEW."confirmedAt"
  ) IS DISTINCT FROM ROW(
   OLD."confirmedById",
   OLD."confirmedAt"
  ) THEN
   RAISE EXCEPTION
    'Refund confirmation evidence is immutable';
  END IF;

 END IF;

 IF NEW."status" = 'RESOLVED_NO_PAYMENT' THEN

  IF NEW."evidenceReference" IS NULL
   OR length(trim(NEW."evidenceReference")) < 5
   OR NEW."resolutionReason" IS NULL
   OR length(trim(NEW."resolutionReason")) < 10
   OR NEW."resolvedById" IS NULL
   OR NEW."resolvedAt" IS NULL
  THEN
   RAISE EXCEPTION
    'Unpaid refund resolution evidence required';
  END IF;

 ELSE

  IF ROW(
   NEW."evidenceReference",
   NEW."resolutionReason",
   NEW."resolvedById",
   NEW."resolvedAt"
  ) IS DISTINCT FROM ROW(
   OLD."evidenceReference",
   OLD."resolutionReason",
   OLD."resolvedById",
   OLD."resolvedAt"
  ) THEN
   RAISE EXCEPTION
    'Unexpected refund resolution modification';
  END IF;

 END IF;

 IF NEW."status" = 'ACCEPTED' THEN

  IF NOT EXISTS (
   SELECT 1
   FROM "PosRefundSettlement" s
   WHERE s."id" = NEW."settlementId"
    AND s."idempotencyKey" = NEW."id"::text
    AND s."returnId" = NEW."returnId"
    AND s."amount" = NEW."amount"
    AND s."method" = NEW."method"
    AND (
     (
      NEW."method" = 'CASH'
      AND s."payoutShiftId" = NEW."shiftId"
     )
     OR
     (
      NEW."method" <> 'CASH'
      AND s."payoutShiftId" IS NULL
     )
    )
  ) THEN
   RAISE EXCEPTION
    'Refund settlement identity or amount mismatch';
  END IF;

 END IF;

 RETURN NEW;

END;
$$;

CREATE FUNCTION r103d24_refund_investigation_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
 a "PosRefundAttempt"%ROWTYPE;
BEGIN

 IF NEW."kind" <> 'REFUND_PAYOUT' THEN
  RETURN NEW;
 END IF;

 SELECT * INTO a
 FROM "PosRefundAttempt"
 WHERE "id" = NEW."refundAttemptId"
 FOR UPDATE;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'Refund investigation attempt missing';
 END IF;

 IF a."status" <> 'PAYMENT_AUTHORIZED'
  OR a."paymentState" <> 'UNKNOWN'
  OR a."authorizedById" IS NULL
  OR a."authorizedAt" IS NULL
  OR a."settlementId" IS NOT NULL
  OR a."authorizedById" IS DISTINCT FROM NEW."paymentOperatorId"
  OR a."payloadHash" IS DISTINCT FROM NEW."payloadHash"
  OR a."locationId" IS DISTINCT FROM NEW."locationId"
  OR a."deviceId" IS DISTINCT FROM NEW."deviceId"
  OR a."shiftId" IS DISTINCT FROM NEW."shiftId"
  OR a."amount" IS DISTINCT FROM NEW."amount"
  OR a."status" IS DISTINCT FROM NEW."originalStatus"
  OR a."paymentState" IS DISTINCT FROM NEW."originalPaymentState"
 THEN
  RAISE EXCEPTION
   'Refund investigation does not match authorized attempt';
 END IF;

 RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_refund_investigation_identity_guard
 BEFORE INSERT OR UPDATE
 ON "PosPaymentReconciliation"
 FOR EACH ROW
 EXECUTE FUNCTION r103d24_refund_investigation_identity();


CREATE FUNCTION r103d24_refund_investigation_commit_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
 a "PosRefundAttempt"%ROWTYPE;
BEGIN

 IF NEW."kind" <> 'REFUND_PAYOUT'
  OR NEW."status" <> 'APPROVED'
 THEN
  RETURN NEW;
 END IF;

 SELECT * INTO a
 FROM "PosRefundAttempt"
 WHERE "id" = NEW."refundAttemptId";

 IF NOT FOUND THEN
  RAISE EXCEPTION 'Approved refund investigation attempt missing';
 END IF;

 IF NEW."proposedOutcome" = 'PAID' THEN

  IF a."status" NOT IN ('PAID','ACCEPTED')
   OR a."paymentState" <> 'CONFIRMED'
   OR a."confirmedById" IS DISTINCT FROM NEW."reviewedById"
   OR a."confirmedAt" IS DISTINCT FROM NEW."reviewedAt"
  THEN
   RAISE EXCEPTION
    'Approved paid investigation must confirm the refund atomically';
  END IF;

 ELSIF NEW."proposedOutcome" = 'NOT_PAID' THEN

  IF a."status" <> 'RESOLVED_NO_PAYMENT'
   OR a."paymentState" <> 'NOT_PAID'
   OR a."resolvedById" IS DISTINCT FROM NEW."reviewedById"
   OR a."resolvedAt" IS DISTINCT FROM NEW."reviewedAt"
   OR a."evidenceReference" IS DISTINCT FROM NEW."evidenceReference"
   OR a."resolutionReason" IS DISTINCT FROM NEW."reason"
  THEN
   RAISE EXCEPTION
    'Approved unpaid investigation must resolve the refund atomically';
  END IF;

 ELSE
  RAISE EXCEPTION 'Invalid approved refund investigation outcome';
 END IF;

 RETURN NEW;

END;
$$;

CREATE CONSTRAINT TRIGGER r103d24_refund_investigation_commit
 AFTER UPDATE
 ON "PosPaymentReconciliation"
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW
 EXECUTE FUNCTION r103d24_refund_investigation_commit_guard();

COMMIT;
