BEGIN;

ALTER TABLE "PosRefundAttempt"
 ADD COLUMN "evidenceReference" VARCHAR(200),
 ADD COLUMN "authorizedById" UUID,
 ADD COLUMN "authorizedAt" TIMESTAMP(3),
 ADD COLUMN "confirmedById" UUID,
 ADD COLUMN "confirmedAt" TIMESTAMP(3);

ALTER TABLE "PosRefundAttempt"
 ADD CONSTRAINT "r103d24_refund_authorizer_fk"
 FOREIGN KEY ("authorizedById")
 REFERENCES "User"("id")
 ON DELETE RESTRICT,

 ADD CONSTRAINT "r103d24_refund_confirmer_fk"
 FOREIGN KEY ("confirmedById")
 REFERENCES "User"("id")
 ON DELETE RESTRICT;

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
   AND NEW."status" = 'PAID'
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

CREATE TRIGGER r103d24_refund_attempt_guard
BEFORE INSERT OR UPDATE OR DELETE
ON "PosRefundAttempt"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_refund_attempt();

CREATE OR REPLACE FUNCTION
 r103d24_guard_refund_settlement_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF EXISTS (
  SELECT 1
  FROM "PosRefundAttempt" a
  WHERE a."settlementId" = OLD."id"
 ) THEN
  RAISE EXCEPTION
   'Linked refund settlement history is immutable';
 END IF;

 IF TG_OP = 'DELETE' THEN
  RETURN OLD;
 END IF;

 RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_refund_settlement_history_guard
BEFORE UPDATE OR DELETE
ON "PosRefundSettlement"
FOR EACH ROW
EXECUTE FUNCTION
 r103d24_guard_refund_settlement_history();

COMMIT;