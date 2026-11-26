BEGIN;

-- R10_3D24C_EXCHANGE_INVESTIGATION_IDENTITY

CREATE FUNCTION r103d24_exchange_investigation_identity()
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

  IF TG_OP='INSERT' AND EXISTS (
   SELECT 1
   FROM "PosPaymentReconciliation" c
   WHERE c."exchangeAttemptId"=a."id"
    AND c."kind"='EXCHANGE_REVERSAL'
    AND c."status"='APPROVED'
    AND c."proposedOutcome"='NOT_REVERSED'
  ) THEN
   RAISE EXCEPTION
    'Abandoned reversal requires exceptional HQ resolution';
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

CREATE TRIGGER r103d24_exchange_investigation_identity_guard
 BEFORE INSERT OR UPDATE
 ON "PosPaymentReconciliation"
 FOR EACH ROW
 EXECUTE FUNCTION r103d24_exchange_investigation_identity();


-- R10_3D24C_EXCHANGE_INVESTIGATION_ATOMIC_APPROVAL

CREATE FUNCTION r103d24_exchange_investigation_commit_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
 a "PosExchangeAttempt"%ROWTYPE;
BEGIN

 IF NEW."kind" NOT IN (
  'EXCHANGE_COLLECTION','EXCHANGE_REVERSAL'
 )
 OR NEW."status"<>'APPROVED'
 THEN
  RETURN NEW;
 END IF;

 SELECT * INTO a
 FROM "PosExchangeAttempt"
 WHERE "id"=NEW."exchangeAttemptId";

 IF NOT FOUND THEN
  RAISE EXCEPTION 'Approved exchange investigation missing attempt';
 END IF;

 IF NEW."proposedOutcome"='COLLECTED' THEN

  IF a."paymentState"<>'CONFIRMED'
   OR a."paymentConfirmedById" IS DISTINCT FROM NEW."reviewedById"
   OR a."paymentConfirmedAt" IS DISTINCT FROM NEW."reviewedAt"
  THEN
   RAISE EXCEPTION
    'Collection approval requires atomic confirmation';
  END IF;

 ELSIF NEW."proposedOutcome"='NOT_COLLECTED' THEN

  IF a."status"<>'RESOLVED_NO_EXCHANGE'
   OR a."paymentState"<>'NOT_COLLECTED'
   OR a."reversalStatus"<>'NONE'
   OR a."resolvedById" IS DISTINCT FROM NEW."reviewedById"
   OR a."resolvedAt" IS DISTINCT FROM NEW."reviewedAt"
   OR a."resolutionReason" IS DISTINCT FROM NEW."reason"
  THEN
   RAISE EXCEPTION
    'Uncollected approval requires atomic resolution';
  END IF;

 ELSIF NEW."proposedOutcome"='REVERSED' THEN

  IF a."reversalStatus"<>'CONFIRMED'
   OR a."reversalConfirmedById" IS DISTINCT FROM NEW."reviewedById"
   OR a."reversalConfirmedAt" IS DISTINCT FROM NEW."reviewedAt"
   OR a."reversalEvidenceReference"
      IS DISTINCT FROM NEW."evidenceReference"
  THEN
   RAISE EXCEPTION
    'Reversal approval requires atomic confirmation';
  END IF;

 ELSIF NEW."proposedOutcome"='NOT_REVERSED' THEN

  IF a."status" IS DISTINCT FROM NEW."originalStatus"
   OR a."paymentState"<>'CONFIRMED'
   OR a."reversalStatus"<>'AUTHORIZED'
   OR a."reversalExecutionAt" IS NULL
   OR a."reversalConfirmedAt" IS NOT NULL
  THEN
   RAISE EXCEPTION
    'Abandoned reversal must remain financially blocked';
  END IF;

 ELSE
  RAISE EXCEPTION 'Invalid exchange investigation outcome';
 END IF;

 RETURN NEW;

END;
$$;

CREATE CONSTRAINT TRIGGER r103d24_exchange_investigation_commit
 AFTER UPDATE
 ON "PosPaymentReconciliation"
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW
 EXECUTE FUNCTION r103d24_exchange_investigation_commit_guard();

COMMIT;