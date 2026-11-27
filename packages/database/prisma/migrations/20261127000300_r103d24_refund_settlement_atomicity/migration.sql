BEGIN;

-- R10_3D24_48B_REFUND_SETTLEMENT_ATOMICITY

CREATE FUNCTION r103d24_refund_settlement_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    a "PosRefundAttempt"%ROWTYPE;
    r "PosReturn"%ROWTYPE;
    sh "PosShift"%ROWTYPE;
BEGIN
    SELECT * INTO a
    FROM "PosRefundAttempt"
    WHERE id::text = NEW."idempotencyKey"
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Central refund registration required';
    END IF;

    IF a.status <> 'PAID'
       OR a."paymentState" <> 'CONFIRMED'
       OR a."settlementId" IS NOT NULL
       OR a."authorizedById" IS NULL
       OR a."authorizedAt" IS NULL
       OR a."confirmedById" IS NULL
       OR a."confirmedAt" IS NULL
       OR a."confirmedAt" < a."authorizedAt"
    THEN
        RAISE EXCEPTION
            'Confirmed unfinalized refund attempt required';
    END IF;

    IF NEW."returnId" IS DISTINCT FROM a."returnId"
       OR NEW.method IS DISTINCT FROM a.method
       OR NEW.amount IS DISTINCT FROM a.amount
       OR NEW.amount <= 0
       OR NEW.method::text NOT IN ('CASH','CARD','OTHER')
    THEN
        RAISE EXCEPTION
            'Refund settlement identity or amount mismatch';
    END IF;

    IF NEW.reference IS DISTINCT FROM
       NULLIF(btrim(a.payload->>'reference'),'')
    THEN
        RAISE EXCEPTION
            'Refund settlement reference mismatch';
    END IF;

    SELECT * INTO r
    FROM "PosReturn"
    WHERE id = NEW."returnId"
    FOR UPDATE;

    IF NOT FOUND
       OR r.status::text <> 'APPROVED'
       OR r."locationId" IS DISTINCT FROM a."locationId"
    THEN
        RAISE EXCEPTION
            'Approved return at registered branch required';
    END IF;

    SELECT * INTO sh
    FROM "PosShift"
    WHERE id = a."shiftId"
    FOR UPDATE;

    IF NOT FOUND
       OR sh.status::text <> 'OPEN'
       OR sh."locationId" IS DISTINCT FROM a."locationId"
       OR sh."deviceId" IS DISTINCT FROM a."deviceId"
    THEN
        RAISE EXCEPTION
            'Open registered refund shift required';
    END IF;

    IF NEW.method::text = 'CASH' THEN
        IF NEW."payoutShiftId" IS DISTINCT FROM a."shiftId"
           OR a.payload->>'payoutShiftId'
              IS DISTINCT FROM a."shiftId"::text
        THEN
            RAISE EXCEPTION
                'Cash refund payout shift mismatch';
        END IF;
    ELSE
        IF NEW."payoutShiftId" IS NOT NULL
           OR a.payload->>'payoutShiftId' IS NOT NULL
           OR NULLIF(btrim(NEW.reference),'') IS NULL
        THEN
            RAISE EXCEPTION
                'Invalid non-cash refund settlement';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER r103d24_refund_settlement_insert
BEFORE INSERT ON "PosRefundSettlement"
FOR EACH ROW
EXECUTE FUNCTION r103d24_refund_settlement_insert_guard();


CREATE FUNCTION r103d24_refund_settlement_commit_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    a "PosRefundAttempt"%ROWTYPE;
    movement_count bigint;
    valid_count bigint;
BEGIN
    SELECT * INTO a
    FROM "PosRefundAttempt"
    WHERE id::text = NEW."idempotencyKey";

    IF NOT FOUND
       OR a.status <> 'ACCEPTED'
       OR a."paymentState" <> 'CONFIRMED'
       OR a."settlementId" IS DISTINCT FROM NEW.id
       OR a."returnId" IS DISTINCT FROM NEW."returnId"
       OR a.amount IS DISTINCT FROM NEW.amount
       OR a.method IS DISTINCT FROM NEW.method
    THEN
        RAISE EXCEPTION
            'Refund settlement was not finalized atomically';
    END IF;

    SELECT
        count(*),
        count(*) FILTER (
            WHERE m.type::text = 'CASH_REFUND'
              AND m.status::text = 'APPROVED'
              AND m.amount = NEW.amount
              AND m."shiftId" = a."shiftId"
              AND m."locationId" = a."locationId"
              AND m."createdById" = NEW."settledById"
              AND m."reviewedById" = NEW."settledById"
              AND m."reviewedAt" IS NOT NULL
        )
    INTO movement_count, valid_count
    FROM "DrawerMovement" m
    WHERE m."externalReference" =
          'POS_REFUND:' || NEW.id::text;

    IF NEW.method::text = 'CASH' THEN
        IF movement_count <> 1 OR valid_count <> 1 THEN
            RAISE EXCEPTION
                'Exactly one matching approved refund cash movement required';
        END IF;
    ELSE
        IF movement_count <> 0 THEN
            RAISE EXCEPTION
                'Non-cash refund cannot create a cash drawer movement';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER r103d24_refund_settlement_commit
AFTER INSERT ON "PosRefundSettlement"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION r103d24_refund_settlement_commit_guard();


CREATE FUNCTION r103d24_refund_drawer_history_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    s "PosRefundSettlement"%ROWTYPE;
    a "PosRefundAttempt"%ROWTYPE;
BEGIN
    IF TG_OP IN ('UPDATE','DELETE') THEN
        IF OLD."externalReference" LIKE 'POS_REFUND:%' THEN
            RAISE EXCEPTION
                'Refund cash movement history is immutable';
        END IF;

        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;

        IF NEW."externalReference" LIKE 'POS_REFUND:%' THEN
            RAISE EXCEPTION
                'Existing movement cannot become a refund settlement movement';
        END IF;

        RETURN NEW;
    END IF;

    IF NEW."externalReference" IS NULL
       OR NEW."externalReference" NOT LIKE 'POS_REFUND:%'
    THEN
        RETURN NEW;
    END IF;

    SELECT * INTO s
    FROM "PosRefundSettlement"
    WHERE 'POS_REFUND:' || id::text =
          NEW."externalReference"
    FOR UPDATE;

    IF NOT FOUND OR s.method::text <> 'CASH' THEN
        RAISE EXCEPTION
            'Matching cash refund settlement required';
    END IF;

    SELECT * INTO a
    FROM "PosRefundAttempt"
    WHERE id::text = s."idempotencyKey"
    FOR UPDATE;

    IF NOT FOUND
       OR a.status <> 'PAID'
       OR a."paymentState" <> 'CONFIRMED'
       OR a."settlementId" IS NOT NULL
       OR NEW.type::text <> 'CASH_REFUND'
       OR NEW.status::text <> 'APPROVED'
       OR NEW.amount IS DISTINCT FROM s.amount
       OR NEW."shiftId" IS DISTINCT FROM a."shiftId"
       OR NEW."shiftId" IS DISTINCT FROM s."payoutShiftId"
       OR NEW."locationId" IS DISTINCT FROM a."locationId"
       OR NEW."createdById" IS DISTINCT FROM s."settledById"
       OR NEW."reviewedById" IS DISTINCT FROM s."settledById"
       OR NEW."reviewedAt" IS NULL
    THEN
        RAISE EXCEPTION
            'Refund cash movement does not match confirmed settlement';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "DrawerMovement"
        WHERE "externalReference" = NEW."externalReference"
    ) THEN
        RAISE EXCEPTION
            'Duplicate refund cash movement prohibited';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER r103d24_refund_drawer_history
BEFORE INSERT OR UPDATE OR DELETE ON "DrawerMovement"
FOR EACH ROW
EXECUTE FUNCTION r103d24_refund_drawer_history_guard();

COMMIT;
