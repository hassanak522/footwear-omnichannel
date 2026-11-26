BEGIN;

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
   OR NEW."paymentConfirmedById"
      IS DISTINCT FROM OLD."paymentAuthorizedById"
   OR OLD."reversalStatus"<>'NONE'
   OR NEW."reversalStatus"<>'NONE'
  THEN
   RAISE EXCEPTION 'Exclusive payment authorization required';
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

CREATE TRIGGER r103d24_exchange_collection_integrity
 BEFORE INSERT OR UPDATE OR DELETE
 ON "PosExchangeAttempt"
 FOR EACH ROW
 EXECUTE FUNCTION r103d24_exchange_collection_guard();

COMMIT;