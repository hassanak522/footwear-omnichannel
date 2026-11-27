BEGIN;

-- R10_3D24_48C_FINANCIAL_HISTORY_IMMUTABILITY

LOCK TABLE
    "PosSale",
    "PosSaleLine",
    "PosSaleTender",
    "PosReturn",
    "PosReturnLine",
    "PosRefundSettlement",
    "PosExchange",
    "DrawerMovement"
IN SHARE ROW EXCLUSIVE MODE;


-- Financial sealing is maintained by database triggers.
-- Existing finalized records are sealed without changing
-- their original financial values.

CREATE TABLE "PosFinancialHistorySeal" (
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosFinancialHistorySeal_pkey"
        PRIMARY KEY ("entityType", "entityId"),

    CONSTRAINT "PosFinancialHistorySeal_entityType_check"
        CHECK ("entityType" IN ('SALE','RETURN'))
);


INSERT INTO "PosFinancialHistorySeal" (
    "entityType",
    "entityId"
)
SELECT 'SALE', id
FROM "PosSale"
WHERE status::text = 'ACCEPTED';


INSERT INTO "PosFinancialHistorySeal" (
    "entityType",
    "entityId"
)
SELECT 'RETURN', id
FROM "PosReturn"
WHERE status::text = 'APPROVED';


CREATE FUNCTION r103d24_financial_seal_history_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Financial history seals are immutable';
END;
$$;


CREATE TRIGGER r103d24_financial_seal_history
BEFORE UPDATE OR DELETE
ON "PosFinancialHistorySeal"
FOR EACH ROW
EXECUTE FUNCTION r103d24_financial_seal_history_guard();


-- Seal newly finalized transactions at commit.

CREATE FUNCTION r103d24_seal_financial_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    entity_type TEXT;
    finalized BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'PosSale' THEN

        entity_type := 'SALE';

        SELECT status::text = 'ACCEPTED'
        INTO finalized
        FROM "PosSale"
        WHERE id = NEW.id;

    ELSIF TG_TABLE_NAME = 'PosReturn' THEN

        entity_type := 'RETURN';

        SELECT status::text = 'APPROVED'
        INTO finalized
        FROM "PosReturn"
        WHERE id = NEW.id;

    ELSE
        RAISE EXCEPTION
            'Unsupported financial parent';
    END IF;

    IF finalized IS TRUE THEN

        INSERT INTO "PosFinancialHistorySeal" (
            "entityType",
            "entityId"
        )
        VALUES (
            entity_type,
            NEW.id
        )
        ON CONFLICT DO NOTHING;

    END IF;

    RETURN NEW;
END;
$$;


CREATE CONSTRAINT TRIGGER r103d24_seal_accepted_sale
AFTER INSERT OR UPDATE ON "PosSale"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION r103d24_seal_financial_parent();


CREATE CONSTRAINT TRIGGER r103d24_seal_approved_return
AFTER INSERT OR UPDATE ON "PosReturn"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION r103d24_seal_financial_parent();


-- Finalized financial parent records cannot be rewritten.

CREATE FUNCTION r103d24_financial_parent_history_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    entity_type TEXT;
    finalized BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'PosSale' THEN

        entity_type := 'SALE';
        finalized := OLD.status::text = 'ACCEPTED';

    ELSIF TG_TABLE_NAME = 'PosReturn' THEN

        entity_type := 'RETURN';
        finalized := OLD.status::text = 'APPROVED';

    ELSE
        RAISE EXCEPTION
            'Unsupported financial parent';
    END IF;

    IF finalized OR EXISTS (
        SELECT 1
        FROM "PosFinancialHistorySeal"
        WHERE "entityType" = entity_type
          AND "entityId" = OLD.id
    ) THEN

        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION
                'Finalized financial transaction cannot be deleted';
        END IF;

        IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
            RAISE EXCEPTION
                'Finalized financial transaction cannot be modified';
        END IF;

    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;


CREATE TRIGGER r103d24_sale_parent_history
BEFORE UPDATE OR DELETE ON "PosSale"
FOR EACH ROW
EXECUTE FUNCTION r103d24_financial_parent_history_guard();


CREATE TRIGGER r103d24_return_parent_history
BEFORE UPDATE OR DELETE ON "PosReturn"
FOR EACH ROW
EXECUTE FUNCTION r103d24_financial_parent_history_guard();


-- Protect financial children and serialize against
-- concurrent parent finalization.

CREATE FUNCTION r103d24_financial_child_history_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    entity_type TEXT;
    old_parent UUID;
    new_parent UUID;
    parent_id UUID;
    parent_status TEXT;
BEGIN
    IF TG_TABLE_NAME IN ('PosSaleLine','PosSaleTender') THEN

        entity_type := 'SALE';

        IF TG_OP <> 'INSERT' THEN
            old_parent := OLD."saleId";
        END IF;

        IF TG_OP <> 'DELETE' THEN
            new_parent := NEW."saleId";
        END IF;

    ELSIF TG_TABLE_NAME = 'PosReturnLine' THEN

        entity_type := 'RETURN';

        IF TG_OP <> 'INSERT' THEN
            old_parent := OLD."returnId";
        END IF;

        IF TG_OP <> 'DELETE' THEN
            new_parent := NEW."returnId";
        END IF;

    ELSE
        RAISE EXCEPTION
            'Unsupported financial child';
    END IF;

    IF TG_OP = 'UPDATE'
       AND old_parent IS DISTINCT FROM new_parent
    THEN
        RAISE EXCEPTION
            'Financial child cannot be reassigned';
    END IF;

    parent_id := COALESCE(old_parent,new_parent);

    IF entity_type = 'SALE' THEN

        SELECT status::text
        INTO parent_status
        FROM "PosSale"
        WHERE id = parent_id
        FOR UPDATE;

    ELSE

        SELECT status::text
        INTO parent_status
        FROM "PosReturn"
        WHERE id = parent_id
        FOR UPDATE;

    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Financial parent not found';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "PosFinancialHistorySeal"
        WHERE "entityType" = entity_type
          AND "entityId" = parent_id
    ) THEN
        RAISE EXCEPTION
            'Sealed financial transaction children are immutable';
    END IF;

    IF TG_OP <> 'INSERT'
       AND (
           (entity_type = 'SALE'
            AND parent_status = 'ACCEPTED')
           OR
           (entity_type = 'RETURN'
            AND parent_status = 'APPROVED')
       )
    THEN
        RAISE EXCEPTION
            'Finalized financial transaction children cannot be changed';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;


CREATE TRIGGER r103d24_sale_line_history
BEFORE INSERT OR UPDATE OR DELETE ON "PosSaleLine"
FOR EACH ROW
EXECUTE FUNCTION r103d24_financial_child_history_guard();


CREATE TRIGGER r103d24_sale_tender_history
BEFORE INSERT OR UPDATE OR DELETE ON "PosSaleTender"
FOR EACH ROW
EXECUTE FUNCTION r103d24_financial_child_history_guard();


CREATE TRIGGER r103d24_return_line_history
BEFORE INSERT OR UPDATE OR DELETE ON "PosReturnLine"
FOR EACH ROW
EXECUTE FUNCTION r103d24_financial_child_history_guard();


-- All refund settlements and exchange records are
-- permanent financial history, including legacy records.

CREATE FUNCTION r103d24_immutable_financial_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'Financial history cannot be deleted';
    END IF;

    IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
        RAISE EXCEPTION
            'Financial history cannot be modified';
    END IF;

    RETURN NEW;
END;
$$;


CREATE TRIGGER r103d24_all_refund_settlement_history
BEFORE UPDATE OR DELETE ON "PosRefundSettlement"
FOR EACH ROW
EXECUTE FUNCTION r103d24_immutable_financial_record();


CREATE TRIGGER r103d24_all_exchange_history
BEFORE UPDATE OR DELETE ON "PosExchange"
FOR EACH ROW
EXECUTE FUNCTION r103d24_immutable_financial_record();


-- Preserve reviewed cash drawer movement history.
-- Pending movements retain their existing review workflow.

CREATE FUNCTION r103d24_reviewed_drawer_history_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status::text IN ('APPROVED','REJECTED') THEN

        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION
                'Reviewed cash movement cannot be deleted';
        END IF;

        IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
            RAISE EXCEPTION
                'Reviewed cash movement cannot be modified';
        END IF;

    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;


CREATE TRIGGER r103d24_reviewed_drawer_history
BEFORE UPDATE OR DELETE ON "DrawerMovement"
FOR EACH ROW
EXECUTE FUNCTION r103d24_reviewed_drawer_history_guard();

COMMIT;
