-- R10.3D23B: Exchange financial integrity.

CREATE FUNCTION "validate_pos_exchange_integrity"(exchange_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
 e record;
 gross_return numeric;
 credit numeric;
 physical numeric;
 paid numeric;
 credit_count bigint;
 invalid_count bigint;
BEGIN

 SELECT
  x."id",
  x."returnId",
  x."replacementSaleId",
  r."saleId" AS original_sale,
  r."locationId" AS return_location,
  r.status::text AS return_status,
  s."locationId" AS replacement_location,
  s.status::text AS replacement_status,
  s.total AS replacement_total
 INTO e
 FROM "PosExchange" x
 JOIN "PosReturn" r ON r.id=x."returnId"
 JOIN "PosSale" s ON s.id=x."replacementSaleId"
 WHERE x.id=exchange_id;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'Exchange relationship missing'
   USING ERRCODE='23514';
 END IF;

 PERFORM id FROM "PosReturn"
 WHERE id=e."returnId"
 FOR UPDATE;

 SELECT COALESCE(SUM("refundAmount"),0)
 INTO gross_return
 FROM "PosReturnLine"
 WHERE "returnId"=e."returnId";

 SELECT
  COALESCE(SUM(amount) FILTER (
   WHERE type::text='EXCHANGE_CREDIT'
  ),0),
  COALESCE(SUM(amount) FILTER (
   WHERE type::text<>'EXCHANGE_CREDIT'
  ),0),
  COUNT(*) FILTER (
   WHERE type::text='EXCHANGE_CREDIT'
  ),
  COUNT(*) FILTER (
   WHERE amount<=0
    OR type::text NOT IN (
     'CASH','CARD','OTHER','EXCHANGE_CREDIT'
    )
    OR (
     type::text='EXCHANGE_CREDIT'
     AND reference IS DISTINCT FROM e."returnId"::text
    )
  )
 INTO credit,physical,credit_count,invalid_count
 FROM "PosSaleTender"
 WHERE "saleId"=e."replacementSaleId";

 SELECT COALESCE(SUM(amount),0)
 INTO paid
 FROM "PosRefundSettlement"
 WHERE "returnId"=e."returnId";

 IF e.original_sale=e."replacementSaleId"
  OR e.return_location<>e.replacement_location
  OR e.return_status<>'APPROVED'
  OR e.replacement_status<>'ACCEPTED'
  OR e.replacement_total<=0
  OR gross_return<0
  OR credit<>LEAST(gross_return,e.replacement_total)
  OR physical+credit<>e.replacement_total
  OR credit_count<>(CASE WHEN credit>0 THEN 1 ELSE 0 END)
  OR invalid_count>0
  OR paid<0
  OR paid>gross_return-credit
 THEN
  RAISE EXCEPTION 'Exchange financial integrity violation'
   USING ERRCODE='23514';
 END IF;

END;
$$;

-- Validate exchange after all transaction records exist.

CREATE FUNCTION "check_pos_exchange_commit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
 PERFORM "validate_pos_exchange_integrity"(NEW.id);
 RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "PosExchange_integrity_guard"
AFTER INSERT ON "PosExchange"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "check_pos_exchange_commit"();

-- Every exchange credit must belong to an exchange.

CREATE FUNCTION "check_pos_exchange_credit_commit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
 exchange_id uuid;
BEGIN

 IF NEW.type::text='EXCHANGE_CREDIT' THEN

  SELECT id INTO exchange_id
  FROM "PosExchange"
  WHERE "replacementSaleId"=NEW."saleId";

  IF exchange_id IS NULL THEN
   RAISE EXCEPTION 'Unallocated exchange credit'
    USING ERRCODE='23514';
  END IF;

  PERFORM "validate_pos_exchange_integrity"(exchange_id);

 END IF;

 RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "PosSaleTender_exchange_credit_guard"
AFTER INSERT OR UPDATE ON "PosSaleTender"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "check_pos_exchange_credit_commit"();

-- Preserve finalized exchange relationships.

CREATE FUNCTION "protect_finalized_pos_exchange"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
 RAISE EXCEPTION 'Finalized exchange relationship is immutable'
  USING ERRCODE='23514';
END;
$$;

CREATE TRIGGER "PosExchange_immutable_guard"
BEFORE UPDATE OR DELETE ON "PosExchange"
FOR EACH ROW
EXECUTE FUNCTION "protect_finalized_pos_exchange"();

-- Protect finalized exchange tender allocations.

CREATE FUNCTION "protect_pos_exchange_tenders"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF TG_OP<>'INSERT' THEN

  IF EXISTS(
   SELECT 1 FROM "PosExchange"
   WHERE "replacementSaleId"=OLD."saleId"
  ) THEN
   RAISE EXCEPTION 'Finalized exchange tenders are immutable'
    USING ERRCODE='23514';
  END IF;

 END IF;

 IF TG_OP<>'DELETE' THEN

  IF EXISTS(
   SELECT 1 FROM "PosExchange"
   WHERE "replacementSaleId"=NEW."saleId"
  ) THEN
   RAISE EXCEPTION 'Finalized exchange tender allocation is locked'
    USING ERRCODE='23514';
  END IF;

 END IF;

 IF TG_OP='DELETE' THEN
  RETURN OLD;
 END IF;

 RETURN NEW;
END;
$$;

CREATE TRIGGER "PosSaleTender_exchange_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "PosSaleTender"
FOR EACH ROW
EXECUTE FUNCTION "protect_pos_exchange_tenders"();

-- Protect return values consumed by exchanges.

CREATE FUNCTION "protect_pos_exchange_return_lines"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF TG_OP<>'INSERT' THEN

  IF EXISTS(
   SELECT 1 FROM "PosExchange"
   WHERE "returnId"=OLD."returnId"
  ) THEN
   RAISE EXCEPTION 'Exchange return allocation is immutable'
    USING ERRCODE='23514';
  END IF;

 END IF;

 IF TG_OP<>'DELETE' THEN

  IF EXISTS(
   SELECT 1 FROM "PosExchange"
   WHERE "returnId"=NEW."returnId"
  ) THEN
   RAISE EXCEPTION 'Exchange return allocation is locked'
    USING ERRCODE='23514';
  END IF;

 END IF;

 IF TG_OP='DELETE' THEN
  RETURN OLD;
 END IF;

 RETURN NEW;
END;
$$;

CREATE TRIGGER "PosReturnLine_exchange_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "PosReturnLine"
FOR EACH ROW
EXECUTE FUNCTION "protect_pos_exchange_return_lines"();

-- Preserve financial identity of finalized replacement sales.

CREATE FUNCTION "protect_pos_exchange_sale"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF EXISTS(
  SELECT 1 FROM "PosExchange"
  WHERE "replacementSaleId"=OLD.id
 ) THEN

  IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'Finalized exchange sale cannot be deleted'
    USING ERRCODE='23514';
  END IF;

  IF NEW.total IS DISTINCT FROM OLD.total
   OR NEW.status IS DISTINCT FROM OLD.status
   OR NEW."locationId" IS DISTINCT FROM OLD."locationId"
   OR NEW."shiftId" IS DISTINCT FROM OLD."shiftId"
   OR NEW."deviceId" IS DISTINCT FROM OLD."deviceId"
   OR NEW."localSaleId" IS DISTINCT FROM OLD."localSaleId"
   OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash"
  THEN
   RAISE EXCEPTION 'Finalized exchange sale identity is immutable'
    USING ERRCODE='23514';
  END IF;

 END IF;

 IF TG_OP='DELETE' THEN
  RETURN OLD;
 END IF;

 RETURN NEW;
END;
$$;

CREATE TRIGGER "PosSale_exchange_identity_guard"
BEFORE UPDATE OR DELETE ON "PosSale"
FOR EACH ROW
EXECUTE FUNCTION "protect_pos_exchange_sale"();

-- Protect finalized exchange return headers.

CREATE FUNCTION "protect_pos_exchange_return"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF EXISTS(
  SELECT 1 FROM "PosExchange"
  WHERE "returnId"=OLD.id
 ) THEN

  IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'Finalized exchange return cannot be deleted'
    USING ERRCODE='23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
   OR NEW."saleId" IS DISTINCT FROM OLD."saleId"
   OR NEW."locationId" IS DISTINCT FROM OLD."locationId"
   OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
  THEN
   RAISE EXCEPTION 'Finalized exchange return identity is immutable'
    USING ERRCODE='23514';
  END IF;

 END IF;

 IF TG_OP='DELETE' THEN
  RETURN OLD;
 END IF;

 RETURN NEW;
END;
$$;

CREATE TRIGGER "PosReturn_exchange_identity_guard"
BEFORE UPDATE OR DELETE ON "PosReturn"
FOR EACH ROW
EXECUTE FUNCTION "protect_pos_exchange_return"();

-- Validate existing exchange records without changing them.

DO $$
DECLARE
 item record;
BEGIN

 FOR item IN SELECT id FROM "PosExchange"
 LOOP
  PERFORM "validate_pos_exchange_integrity"(item.id);
 END LOOP;

 IF EXISTS(
  SELECT 1
  FROM "PosSaleTender" t
  LEFT JOIN "PosExchange" e
   ON e."replacementSaleId"=t."saleId"
  WHERE t.type::text='EXCHANGE_CREDIT'
   AND e.id IS NULL
 ) THEN
  RAISE EXCEPTION 'Historical orphan exchange credits require reconciliation';
 END IF;

END;
$$;