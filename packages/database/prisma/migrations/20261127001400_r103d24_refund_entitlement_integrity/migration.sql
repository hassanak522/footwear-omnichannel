BEGIN;

-- R10_3D24_48D3G4D4G_REFUND_ENTITLEMENT_INTEGRITY

CREATE FUNCTION r103d24_assert_refund_correction_hold(
    target_return UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtext(
            'pos-refund-settlement:' ||
            target_return::text
        )
    );

    IF EXISTS (
        SELECT 1
        FROM "PosFinancialCorrection" c
        JOIN "PosRefundAttempt" a
          ON a."id" = c."refundAttemptId"
        WHERE a."returnId" = target_return
          AND c."status" IN ('PENDING','APPROVED')
    ) THEN
        RAISE EXCEPTION
            'Active financial correction blocks refund execution';
    END IF;
END;
$$;

CREATE FUNCTION r103d24_guard_refund_correction_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM r103d24_assert_refund_correction_hold(
        NEW."returnId"
    );

    IF EXISTS (
        SELECT 1
        FROM "RefundRecord" r
        WHERE r."returnId" = NEW."returnId"
    ) THEN
        RAISE EXCEPTION
            'Legacy refund record blocks POS refund settlement';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER r103d24_refund_correction_settlement_guard
BEFORE INSERT ON "PosRefundSettlement"
FOR EACH ROW
EXECUTE FUNCTION
    r103d24_guard_refund_correction_settlement();

CREATE FUNCTION r103d24_guard_legacy_refund_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW."returnId" IS DISTINCT FROM OLD."returnId"
           OR NEW."locationId" IS DISTINCT FROM OLD."locationId"
           OR NEW."amount" IS DISTINCT FROM OLD."amount"
           OR NEW."method" IS DISTINCT FROM OLD."method"
        THEN
            RAISE EXCEPTION
                'Legacy refund financial identity is immutable';
        END IF;

        IF OLD."status" = 'PAID'
           AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
        THEN
            RAISE EXCEPTION
                'Paid legacy refund is immutable';
        END IF;
    END IF;

    IF TG_OP = 'INSERT'
       OR NEW."status" IN ('APPROVED','PAID')
    THEN
        PERFORM r103d24_assert_refund_correction_hold(
            NEW."returnId"
        );

        IF EXISTS (
            SELECT 1
            FROM "PosRefundAttempt" a
            WHERE a."returnId" = NEW."returnId"
              AND a."status" NOT IN (
                  'ACCEPTED',
                  'RESOLVED_NO_PAYMENT'
              )
        ) THEN
            RAISE EXCEPTION
                'Unresolved POS refund blocks legacy refund';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM "PosRefundSettlement" s
            WHERE s."returnId" = NEW."returnId"
        ) THEN
            RAISE EXCEPTION
                'POS refund settlement blocks legacy refund';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER r103d24_legacy_refund_transition_guard
BEFORE INSERT OR UPDATE ON "RefundRecord"
FOR EACH ROW
EXECUTE FUNCTION
    r103d24_guard_legacy_refund_transition();


-- R10_3D24_48D3G4D4I_RECIPROCAL_INTEGRITY

CREATE FUNCTION r103d24_guard_legacy_refund_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Legacy refund history cannot be deleted';
END;
$$;

CREATE TRIGGER r103d24_legacy_refund_delete_guard
BEFORE DELETE ON "RefundRecord"
FOR EACH ROW
EXECUTE FUNCTION
    r103d24_guard_legacy_refund_delete();


CREATE FUNCTION r103d24_historical_refund_total(
    target_return UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    historical NUMERIC;
BEGIN
    SELECT COALESCE(SUM(e."amount"),0)
    INTO historical
    FROM "PosFinancialCorrectionEconomicEvent" e
    JOIN "PosFinancialCorrection" c
      ON c."id" = e."correctionId"
    JOIN "PosRefundAttempt" a
      ON a."id" = c."refundAttemptId"
    WHERE a."returnId" = target_return
      AND c."status" = 'APPROVED'
      AND c."correctionType" =
          'CONTRADICTORY_REFUND_PAYMENT'
      AND e."direction" = 'OUTFLOW';

    RETURN historical;
END;
$$;


CREATE FUNCTION r103d24_guard_reciprocal_refund_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN

        IF NEW."status" IS NOT DISTINCT FROM OLD."status"
           AND NEW."paymentState"
               IS NOT DISTINCT FROM OLD."paymentState"
        THEN
            RETURN NEW;
        END IF;

        -- Permit terminal reconciliation without
        -- authorizing another physical payment.

        IF NEW."status" = 'RESOLVED_NO_PAYMENT' THEN
            RETURN NEW;
        END IF;

    END IF;

    PERFORM r103d24_assert_refund_correction_hold(
        NEW."returnId"
    );

    IF EXISTS (
        SELECT 1
        FROM "RefundRecord" r
        WHERE r."returnId" = NEW."returnId"
    ) THEN
        RAISE EXCEPTION
            'Legacy refund blocks POS refund execution';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER r103d24_reciprocal_refund_attempt_guard
BEFORE INSERT OR UPDATE ON "PosRefundAttempt"
FOR EACH ROW
EXECUTE FUNCTION
    r103d24_guard_reciprocal_refund_attempt();


CREATE FUNCTION r103d24_guard_reciprocal_correction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_return UUID;
BEGIN
    IF NEW."refundAttemptId" IS NULL
       OR NEW."status" = 'REJECTED'
    THEN
        RETURN NEW;
    END IF;

    SELECT a."returnId"
    INTO STRICT target_return
    FROM "PosRefundAttempt" a
    WHERE a."id" = NEW."refundAttemptId";

    PERFORM pg_advisory_xact_lock(
        hashtext(
            'pos-refund-settlement:' ||
            target_return::text
        )
    );

    IF EXISTS (
        SELECT 1
        FROM "RefundRecord" r
        WHERE r."returnId" = target_return
          AND r."status" IN ('REQUESTED','APPROVED')
    ) THEN
        RAISE EXCEPTION
            'Outstanding legacy refund requires reconciliation';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "PosRefundAttempt" a
        WHERE a."returnId" = target_return
          AND a."id" <> NEW."refundAttemptId"
          AND a."status" NOT IN (
              'ACCEPTED',
              'RESOLVED_NO_PAYMENT'
          )
    ) THEN
        RAISE EXCEPTION
            'Competing POS refund attempt requires reconciliation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER r103d24_reciprocal_correction_guard
BEFORE INSERT OR UPDATE ON "PosFinancialCorrection"
FOR EACH ROW
EXECUTE FUNCTION
    r103d24_guard_reciprocal_correction();


CREATE OR REPLACE FUNCTION
    r103d24_guard_refund_correction_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    approved NUMERIC;
    paid NUMERIC;
    historical NUMERIC;
    credit NUMERIC;
BEGIN
    PERFORM r103d24_assert_refund_correction_hold(
        NEW."returnId"
    );

    IF EXISTS (
        SELECT 1
        FROM "RefundRecord" r
        WHERE r."returnId" = NEW."returnId"
    ) THEN
        RAISE EXCEPTION
            'Legacy refund record blocks POS refund settlement';
    END IF;

    PERFORM 1
    FROM "PosReturn"
    WHERE "id" = NEW."returnId"
    FOR UPDATE;

    SELECT COALESCE(SUM("refundAmount"),0)
    INTO approved
    FROM "PosReturnLine"
    WHERE "returnId" = NEW."returnId";

    SELECT COALESCE(SUM("amount"),0)
    INTO paid
    FROM "PosRefundSettlement"
    WHERE "returnId" = NEW."returnId";

    SELECT COALESCE(SUM(t."amount"),0)
    INTO credit
    FROM "PosExchange" x
    JOIN "PosSaleTender" t
      ON t."saleId" = x."replacementSaleId"
    WHERE x."returnId" = NEW."returnId"
      AND t."type"::text = 'EXCHANGE_CREDIT';

    historical :=
        r103d24_historical_refund_total(
            NEW."returnId"
        );

    IF NEW."amount" <= 0
       OR paid + historical + credit + NEW."amount"
          > approved
    THEN
        RAISE EXCEPTION
            'Refund exceeds remaining historical entitlement';
    END IF;

    RETURN NEW;
END;
$$;

COMMIT;
