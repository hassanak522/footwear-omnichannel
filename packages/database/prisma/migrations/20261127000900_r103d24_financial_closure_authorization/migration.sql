BEGIN;

-- R10_3D24_48D3G3_FINANCIAL_CLOSURE_AUTHORIZATION

CREATE TABLE "PosFinancialCorrectionClosure" (

    "id" UUID PRIMARY KEY,
    "correctionId" UUID NOT NULL UNIQUE,
    "executionId" UUID NOT NULL UNIQUE,
    "postingId" UUID NOT NULL UNIQUE,
    "locationId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "authorizedById" UUID NOT NULL,
    "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closureNote" VARCHAR(1000) NOT NULL,

    CONSTRAINT r103d24_closure_amount
        CHECK ("amount" > 0),

    CONSTRAINT r103d24_closure_note
        CHECK (length(btrim("closureNote")) >= 20),

    CONSTRAINT r103d24_closure_correction_fk
        FOREIGN KEY ("correctionId")
        REFERENCES "PosFinancialCorrection"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT r103d24_closure_execution_fk
        FOREIGN KEY ("executionId")
        REFERENCES "PosFinancialCorrectionExecution"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT r103d24_closure_posting_fk
        FOREIGN KEY ("postingId")
        REFERENCES "PosFinancialCorrectionPosting"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT r103d24_closure_location_fk
        FOREIGN KEY ("locationId")
        REFERENCES "Location"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT r103d24_closure_actor_fk
        FOREIGN KEY ("authorizedById")
        REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX
    "PosFinancialCorrectionClosure_locationId_authorizedAt_idx"
ON "PosFinancialCorrectionClosure"(
    "locationId","authorizedAt"
);

CREATE FUNCTION r103d24_guard_financial_closure()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    c "PosFinancialCorrection"%ROWTYPE;
    e "PosFinancialCorrectionExecution"%ROWTYPE;
    p "PosFinancialCorrectionPosting"%ROWTYPE;
    i "PosPaymentReconciliation"%ROWTYPE;
BEGIN

    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION
            'Financial closure authorization is immutable';
    END IF;

    SELECT * INTO STRICT c
    FROM "PosFinancialCorrection"
    WHERE id = NEW."correctionId"
    FOR UPDATE;

    SELECT * INTO STRICT e
    FROM "PosFinancialCorrectionExecution"
    WHERE id = NEW."executionId";

    SELECT * INTO STRICT p
    FROM "PosFinancialCorrectionPosting"
    WHERE id = NEW."postingId";

    SELECT * INTO STRICT i
    FROM "PosPaymentReconciliation"
    WHERE id = c."investigationId";

    PERFORM r103d24_verify_correction_journal(
        p."journalId"
    );

    IF c.status <> 'APPROVED'
       OR i.status <> 'APPROVED'
       OR i."executionAbandoned" IS DISTINCT FROM TRUE
       OR e."correctionId" IS DISTINCT FROM c.id
       OR p."correctionId" IS DISTINCT FROM c.id
       OR p."executionId" IS DISTINCT FROM e.id
       OR NEW."locationId" IS DISTINCT FROM c."locationId"
       OR NEW.amount IS DISTINCT FROM c.amount
       OR NEW."authorizedAt" < p."postedAt"
       OR NEW."authorizedAt" >
           clock_timestamp() AT TIME ZONE 'UTC'
       OR NEW."authorizedById" = c."submittedById"
       OR NEW."authorizedById" = i."paymentOperatorId"
       OR NEW."authorizedById" = e."recordedById"
       OR NEW."authorizedById" = p."postedById"
    THEN
        RAISE EXCEPTION
            'Financial closure authorization integrity failure';
    END IF;

    RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_financial_closure_guard
BEFORE INSERT OR UPDATE OR DELETE
ON "PosFinancialCorrectionClosure"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_financial_closure();

COMMIT;
