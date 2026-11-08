-- Defense in depth: settlement amounts may not exceed the approved return.
-- Lock the parent return to serialize concurrent writers even outside the API.
CREATE FUNCTION "guard_online_refund_balance"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approved numeric; paid numeric;
BEGIN
 SELECT "merchandiseAmount" INTO approved FROM "OnlineReturn" WHERE id=NEW."returnId" FOR UPDATE;
 IF approved IS NULL THEN RAISE EXCEPTION 'Online refund return does not exist' USING ERRCODE='23503'; END IF;
 SELECT COALESCE(SUM(amount),0) INTO paid FROM "OnlineRefundSettlement"
 WHERE "returnId"=NEW."returnId" AND id IS DISTINCT FROM NEW.id;
 IF NEW.amount<=0 OR paid+NEW.amount>approved THEN
  RAISE EXCEPTION 'Online refund exceeds approved merchandise amount' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OnlineRefundSettlement_balance_guard" BEFORE INSERT OR UPDATE ON "OnlineRefundSettlement"
 FOR EACH ROW EXECUTE FUNCTION "guard_online_refund_balance"();

CREATE FUNCTION "guard_pos_refund_balance"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approved numeric; paid numeric; return_status text;
BEGIN
 SELECT status::text INTO return_status FROM "PosReturn" WHERE id=NEW."returnId" FOR UPDATE;
 IF return_status IS NULL THEN RAISE EXCEPTION 'POS refund return does not exist' USING ERRCODE='23503'; END IF;
 IF return_status<>'APPROVED' THEN RAISE EXCEPTION 'POS refund return is not approved' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(SUM("refundAmount"),0) INTO approved FROM "PosReturnLine" WHERE "returnId"=NEW."returnId";
 SELECT COALESCE(SUM(amount),0) INTO paid FROM "PosRefundSettlement"
 WHERE "returnId"=NEW."returnId" AND id IS DISTINCT FROM NEW.id;
 IF NEW.amount<=0 OR paid+NEW.amount>approved THEN
  RAISE EXCEPTION 'POS refund exceeds approved return amount' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PosRefundSettlement_balance_guard" BEFORE INSERT OR UPDATE ON "PosRefundSettlement"
 FOR EACH ROW EXECUTE FUNCTION "guard_pos_refund_balance"();
