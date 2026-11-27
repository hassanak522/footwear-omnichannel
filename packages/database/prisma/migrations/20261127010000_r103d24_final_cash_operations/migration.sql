BEGIN;

CREATE TABLE "PosCashDenominationCount" (
    "id" UUID NOT NULL PRIMARY KEY,
    "shiftId" UUID NOT NULL UNIQUE,
    "locationId" UUID NOT NULL,
    "denominations" JSONB NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY ("shiftId")
      REFERENCES "PosShift"("id") ON DELETE RESTRICT,

    FOREIGN KEY ("locationId")
      REFERENCES "Location"("id") ON DELETE RESTRICT,

    FOREIGN KEY ("recordedById")
      REFERENCES "User"("id") ON DELETE RESTRICT,

    CHECK ("total" >= 0),
    CHECK (jsonb_typeof("denominations") = 'object')
);

CREATE INDEX "PosCashDenominationCount_locationId_recordedAt_idx"
ON "PosCashDenominationCount"("locationId","recordedAt");

CREATE TABLE "PosCashHandover" (
    "id" UUID NOT NULL PRIMARY KEY,
    "shiftId" UUID NOT NULL UNIQUE,
    "locationId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "submittedById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionNote" VARCHAR(1000) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'SUBMITTED',
    "acknowledgedById" UUID,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgementNote" VARCHAR(1000),

    FOREIGN KEY ("shiftId")
      REFERENCES "PosShift"("id") ON DELETE RESTRICT,

    FOREIGN KEY ("locationId")
      REFERENCES "Location"("id") ON DELETE RESTRICT,

    FOREIGN KEY ("submittedById")
      REFERENCES "User"("id") ON DELETE RESTRICT,

    FOREIGN KEY ("acknowledgedById")
      REFERENCES "User"("id") ON DELETE RESTRICT,

    CHECK ("amount" >= 0),

    CHECK (length(btrim("submissionNote")) >= 3),

    CHECK (
      (
        "status" = 'SUBMITTED'
        AND "acknowledgedById" IS NULL
        AND "acknowledgedAt" IS NULL
        AND "acknowledgementNote" IS NULL
      )
      OR
      (
        "status" = 'ACKNOWLEDGED'
        AND "acknowledgedById" IS NOT NULL
        AND "acknowledgedById" <> "submittedById"
        AND "acknowledgedAt" IS NOT NULL
        AND "acknowledgedAt" >= "submittedAt"
        AND "acknowledgementNote" IS NOT NULL
        AND length(btrim("acknowledgementNote")) >= 3
      )
    )
);

CREATE INDEX "PosCashHandover_locationId_status_submittedAt_idx"
ON "PosCashHandover"("locationId","status","submittedAt");

CREATE FUNCTION r103d24_final_guard_cash_count()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    s "PosShift"%ROWTYPE;
    c "PosShiftClosingSnapshot"%ROWTYPE;
    item RECORD;
    quantity NUMERIC;
    computed NUMERIC := 0;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Cash denomination count is immutable';
    END IF;

    SELECT * INTO STRICT s
    FROM "PosShift"
    WHERE "id" = NEW."shiftId"
    FOR UPDATE;

    SELECT * INTO STRICT c
    FROM "PosShiftClosingSnapshot"
    WHERE "shiftId" = NEW."shiftId";

    IF s."status" <> 'CLOSED'
       OR s."locationId" <> NEW."locationId"
       OR c."locationId" <> NEW."locationId"
       OR c."cashierId" <> s."cashierId"
       OR c."deviceId" <> s."deviceId"
       OR c."countedCash" <> NEW."total" THEN
        RAISE EXCEPTION 'Cash count snapshot mismatch';
    END IF;

    FOR item IN
        SELECT * FROM jsonb_each(NEW."denominations")
    LOOP
        IF item.key NOT IN (
            '1','2','5','10','20','50',
            '100','500','1000','5000'
        ) OR jsonb_typeof(item.value) <> 'number' THEN
            RAISE EXCEPTION 'Invalid cash denomination';
        END IF;

        quantity := item.value::text::numeric;

        IF quantity < 0
           OR quantity > 1000000
           OR quantity <> trunc(quantity) THEN
            RAISE EXCEPTION 'Invalid denomination quantity';
        END IF;

        computed := computed + item.key::numeric * quantity;
    END LOOP;

    IF computed <> NEW."total" THEN
        RAISE EXCEPTION 'Cash denomination total mismatch';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER r103d24_final_cash_count_guard
BEFORE INSERT OR UPDATE OR DELETE
ON "PosCashDenominationCount"
FOR EACH ROW
EXECUTE FUNCTION r103d24_final_guard_cash_count();

CREATE FUNCTION r103d24_final_guard_handover()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    s "PosShift"%ROWTYPE;
    c "PosShiftClosingSnapshot"%ROWTYPE;
    d "PosCashDenominationCount"%ROWTYPE;
    r "CashReconciliation"%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Cash handover cannot be deleted';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'SUBMITTED' THEN
            RAISE EXCEPTION 'Initial handover must be submitted';
        END IF;
    ELSE
        IF OLD."status" <> 'SUBMITTED'
           OR NEW."status" <> 'ACKNOWLEDGED'
           OR (
              to_jsonb(OLD) - ARRAY[
                'status',
                'acknowledgedById',
                'acknowledgedAt',
                'acknowledgementNote'
              ]
           ) IS DISTINCT FROM (
              to_jsonb(NEW) - ARRAY[
                'status',
                'acknowledgedById',
                'acknowledgedAt',
                'acknowledgementNote'
              ]
           ) THEN
            RAISE EXCEPTION 'Invalid cash handover transition';
        END IF;
    END IF;

    SELECT * INTO STRICT s
    FROM "PosShift"
    WHERE "id" = NEW."shiftId"
    FOR UPDATE;

    SELECT * INTO STRICT c
    FROM "PosShiftClosingSnapshot"
    WHERE "shiftId" = NEW."shiftId";

    SELECT * INTO STRICT d
    FROM "PosCashDenominationCount"
    WHERE "shiftId" = NEW."shiftId";

    SELECT * INTO STRICT r
    FROM "CashReconciliation"
    WHERE "shiftId" = NEW."shiftId";

    IF s."status" <> 'CLOSED'
       OR s."locationId" <> NEW."locationId"
       OR c."locationId" <> NEW."locationId"
       OR d."locationId" <> NEW."locationId"
       OR r."locationId" <> NEW."locationId"
       OR r."status" <> 'APPROVED'
       OR c."countedCash" <> NEW."amount"
       OR d."total" <> NEW."amount"
       OR r."countedCash" <> NEW."amount" THEN
        RAISE EXCEPTION 'Cash handover integrity mismatch';
    END IF;

    IF NEW."status" = 'ACKNOWLEDGED'
       AND NEW."acknowledgedById" = s."cashierId" THEN
        RAISE EXCEPTION 'Cashier cannot acknowledge own cash';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER r103d24_final_cash_handover_guard
BEFORE INSERT OR UPDATE OR DELETE
ON "PosCashHandover"
FOR EACH ROW
EXECUTE FUNCTION r103d24_final_guard_handover();

COMMIT;