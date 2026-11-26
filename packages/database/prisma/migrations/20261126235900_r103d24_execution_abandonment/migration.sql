BEGIN;

-- R10_3D24C_DATABASE_PERMANENT_REFUND_ABANDONMENT

CREATE FUNCTION r103d24_refund_abandonment_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF OLD."status"='PAYMENT_AUTHORIZED'
  AND NEW."status"='PAID'
 THEN

  IF EXISTS (
   SELECT 1
   FROM "PosPaymentReconciliation" c
   WHERE c."refundAttemptId"=OLD."id"
    AND c."kind"='REFUND_PAYOUT'
    AND c."proposedOutcome"='NOT_PAID'
    AND c."executionAbandoned"=true
  )
  AND NOT EXISTS (
   SELECT 1
   FROM "PosPaymentReconciliation" c
   WHERE c."refundAttemptId"=OLD."id"
    AND c."kind"='REFUND_PAYOUT'
    AND c."status"='APPROVED'
    AND c."proposedOutcome"='PAID'
    AND c."paymentOperatorId"=OLD."authorizedById"
    AND c."payloadHash"=OLD."payloadHash"
    AND c."locationId"=OLD."locationId"
    AND c."deviceId"=OLD."deviceId"
    AND c."shiftId"=OLD."shiftId"
    AND c."amount"=OLD."amount"
    AND c."reviewedById"=NEW."confirmedById"
    AND c."reviewedAt"=NEW."confirmedAt"
  )
  THEN
   RAISE EXCEPTION
    'Abandoned refund requires independent payout reconciliation';
  END IF;

 END IF;

 RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_refund_abandonment
 BEFORE UPDATE
 ON "PosRefundAttempt"
 FOR EACH ROW
 EXECUTE FUNCTION r103d24_refund_abandonment_guard();


-- R10_3D24C_DATABASE_PERMANENT_EXCHANGE_ABANDONMENT

CREATE FUNCTION r103d24_exchange_abandonment_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF OLD."paymentState"='UNCONFIRMED'
  AND NEW."paymentState"='CONFIRMED'
 THEN

  IF EXISTS (
   SELECT 1
   FROM "PosPaymentReconciliation" c
   WHERE c."exchangeAttemptId"=OLD."id"
    AND c."kind"='EXCHANGE_COLLECTION'
    AND c."proposedOutcome"='NOT_COLLECTED'
    AND c."executionAbandoned"=true
  )
  AND NOT EXISTS (
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
    AND c."reviewedById"=NEW."paymentConfirmedById"
    AND c."reviewedAt"=NEW."paymentConfirmedAt"
  )
  THEN
   RAISE EXCEPTION
    'Abandoned collection requires independent reconciliation';
  END IF;

 END IF;

 IF OLD."reversalStatus"='AUTHORIZED'
  AND NEW."reversalStatus"='CONFIRMED'
 THEN

  IF EXISTS (
   SELECT 1
   FROM "PosPaymentReconciliation" c
   WHERE c."exchangeAttemptId"=OLD."id"
    AND c."kind"='EXCHANGE_REVERSAL'
    AND c."proposedOutcome"='NOT_REVERSED'
    AND c."executionAbandoned"=true
  )
  AND NOT EXISTS (
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
    AND c."reviewedById"=NEW."reversalConfirmedById"
    AND c."reviewedAt"=NEW."reversalConfirmedAt"
    AND c."evidenceReference"=NEW."reversalEvidenceReference"
  )
  THEN
   RAISE EXCEPTION
    'Abandoned reversal requires independent reconciliation';
  END IF;

 END IF;

 IF NEW."status"='RESOLVED_NO_EXCHANGE'
  AND OLD."status"<>'RESOLVED_NO_EXCHANGE'
  AND NEW."paymentState"='REVERSED'
 THEN

  IF NEW."resolvedById" IS NULL
   OR NEW."resolvedById"=NEW."reversalExecutionById"
   OR NEW."resolvedById"=NEW."reversalConfirmedById"
  THEN
   RAISE EXCEPTION
    'Independent reversal finalizer required';
  END IF;

 END IF;

 RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_exchange_abandonment
 BEFORE UPDATE
 ON "PosExchangeAttempt"
 FOR EACH ROW
 EXECUTE FUNCTION r103d24_exchange_abandonment_guard();

COMMIT;