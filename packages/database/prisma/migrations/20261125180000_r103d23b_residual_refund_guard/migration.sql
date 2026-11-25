-- R10.3D23B: Enforce residual POS refund limits.
-- Exchange credit is not a physical refund settlement.

CREATE OR REPLACE FUNCTION "guard_pos_refund_balance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
 approved numeric;
 paid numeric;
 credit numeric;
 return_status text;
 return_location uuid;
 exchange_sale uuid;
 replacement_status text;
 replacement_location uuid;
BEGIN

 SELECT status::text, "locationId"
 INTO return_status, return_location
 FROM "PosReturn"
 WHERE id=NEW."returnId"
 FOR UPDATE;

 IF return_status IS NULL THEN
  RAISE EXCEPTION 'POS refund return does not exist'
   USING ERRCODE='23503';
 END IF;

 IF return_status<>'APPROVED' THEN
  RAISE EXCEPTION 'POS refund return is not approved'
   USING ERRCODE='23514';
 END IF;

 IF NEW.method::text NOT IN ('CASH','CARD','OTHER') THEN
  RAISE EXCEPTION 'Invalid physical refund settlement method'
   USING ERRCODE='23514';
 END IF;

 SELECT COALESCE(SUM("refundAmount"),0)
 INTO approved
 FROM "PosReturnLine"
 WHERE "returnId"=NEW."returnId";

 credit := 0;

 SELECT "replacementSaleId"
 INTO exchange_sale
 FROM "PosExchange"
 WHERE "returnId"=NEW."returnId";

 IF exchange_sale IS NOT NULL THEN

  SELECT status::text, "locationId"
  INTO replacement_status, replacement_location
  FROM "PosSale"
  WHERE id=exchange_sale;

  IF replacement_status IS DISTINCT FROM 'ACCEPTED'
   OR replacement_location IS DISTINCT FROM return_location
  THEN
   RAISE EXCEPTION 'Exchange replacement requires reconciliation'
    USING ERRCODE='23514';
  END IF;

  SELECT COALESCE(SUM(amount),0)
  INTO credit
  FROM "PosSaleTender"
  WHERE "saleId"=exchange_sale
   AND type::text='EXCHANGE_CREDIT';

  IF credit<0 OR credit>approved THEN
   RAISE EXCEPTION 'Invalid exchange credit allocation'
    USING ERRCODE='23514';
  END IF;

 END IF;

 SELECT COALESCE(SUM(amount),0)
 INTO paid
 FROM "PosRefundSettlement"
 WHERE "returnId"=NEW."returnId"
  AND id IS DISTINCT FROM NEW.id;

 IF NEW.amount IS NULL
  OR NEW.amount<=0
  OR paid+NEW.amount>approved-credit
 THEN
  RAISE EXCEPTION 'POS refund exceeds residual refundable amount'
   USING ERRCODE='23514';
 END IF;

 RETURN NEW;

END $$;