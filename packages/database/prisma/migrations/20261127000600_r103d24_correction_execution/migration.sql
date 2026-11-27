CREATE TABLE "PosFinancialCorrectionExecution" (
    "id" UUID NOT NULL,
    "correctionId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "executionType" VARCHAR(40) NOT NULL,
    "evidenceReference" VARCHAR(200) NOT NULL,
    "evidenceNote" VARCHAR(1000) NOT NULL,
    "debitAccountCode" VARCHAR(32) NOT NULL,
    "creditAccountCode" VARCHAR(32) NOT NULL,
    "postingBatchId" UUID NOT NULL,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosFinancialCorrectionExecution_pkey"
        PRIMARY KEY ("id"),

    CONSTRAINT "r103d24_correction_execution_amount"
        CHECK ("amount" > 0),

    CONSTRAINT "r103d24_correction_execution_type"
        CHECK ("executionType" IN (
            'VERIFIED_HISTORICAL_PAYMENT',
            'VERIFIED_CORRECTIVE_REVERSAL'
        )),

    CONSTRAINT "r103d24_correction_execution_evidence"
        CHECK (
            length(btrim("evidenceReference")) >= 5
            AND length(btrim("evidenceNote")) >= 10
        ),

    CONSTRAINT "r103d24_correction_execution_accounts"
        CHECK (
            "debitAccountCode" ~ '^[A-Za-z0-9_-]{2,32}$'
            AND "creditAccountCode" ~ '^[A-Za-z0-9_-]{2,32}$'
            AND lower("debitAccountCode") <>
                lower("creditAccountCode")
        ),

    CONSTRAINT "r103d24_correction_execution_correction_fk"
        FOREIGN KEY ("correctionId")
        REFERENCES "PosFinancialCorrection"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "r103d24_correction_execution_batch_fk"
        FOREIGN KEY ("postingBatchId")
        REFERENCES "FinancePostingBatch"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "r103d24_correction_execution_actor_fk"
        FOREIGN KEY ("recordedById")
        REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX
    "PosFinancialCorrectionExecution_correctionId_key"
ON "PosFinancialCorrectionExecution"("correctionId");

CREATE UNIQUE INDEX
    "PosFinancialCorrectionExecution_postingBatchId_key"
ON "PosFinancialCorrectionExecution"("postingBatchId");

CREATE INDEX
    "PosFinancialCorrectionExecution_locationId_recordedAt_idx"
ON "PosFinancialCorrectionExecution"("locationId","recordedAt");


CREATE FUNCTION r103d24_guard_correction_execution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    c "PosFinancialCorrection"%ROWTYPE;
    i "PosPaymentReconciliation"%ROWTYPE;
    b "FinancePostingBatch"%ROWTYPE;
    line_count BIGINT;
    debit_count BIGINT;
    credit_count BIGINT;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION
            'Financial correction execution history is immutable';
    END IF;

    SELECT * INTO c
    FROM "PosFinancialCorrection"
    WHERE id = NEW."correctionId"
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Correction not found';
    END IF;

    IF c.status <> 'APPROVED'
       OR c."reviewedById" IS NULL
       OR c."reviewedAt" IS NULL
       OR c."locationId" <> NEW."locationId"
       OR c.amount <> NEW.amount
       OR NEW."recordedAt" < c."reviewedAt"
    THEN
        RAISE EXCEPTION
            'Correction approval or execution identity mismatch';
    END IF;

    SELECT * INTO i
    FROM "PosPaymentReconciliation"
    WHERE id = c."investigationId";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original investigation not found';
    END IF;

    IF NEW."recordedById" = c."submittedById"
       OR NEW."recordedById" = c."reviewedById"
       OR NEW."recordedById" = i."paymentOperatorId"
       OR NEW."recordedById" = i."submittedById"
       OR NEW."recordedById" = i."reviewedById"
    THEN
        RAISE EXCEPTION
            'Independent correction execution recorder required';
    END IF;

    IF c."correctionType" = 'UNRESOLVED_EXCHANGE_REVERSAL' THEN
        IF NEW."executionType" <> 'VERIFIED_CORRECTIVE_REVERSAL' THEN
            RAISE EXCEPTION 'Incorrect reversal execution type';
        END IF;
    ELSE
        IF NEW."executionType" <> 'VERIFIED_HISTORICAL_PAYMENT' THEN
            RAISE EXCEPTION 'Incorrect historical payment execution type';
        END IF;
    END IF;

    IF lower(btrim(NEW."evidenceReference")) =
       lower(btrim(i."evidenceReference"))
    THEN
        RAISE EXCEPTION 'Contradictory evidence cannot be reused';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtext(NEW."locationId"::text)
    );

    IF EXISTS (
        SELECT 1
        FROM "FinancePeriodLock" p
        WHERE p."locationId" = NEW."locationId"
          AND p."periodStart" <= NEW."recordedAt"
          AND p."periodEnd" > NEW."recordedAt"
    ) THEN
        RAISE EXCEPTION
            'Correction accounting period is locked';
    END IF;

    SELECT * INTO b
    FROM "FinancePostingBatch"
    WHERE id = NEW."postingBatchId"
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Correction posting batch not found';
    END IF;

    IF b."sourceType" <> 'POS_FINANCIAL_CORRECTION'
       OR b."sourceId" <> NEW."correctionId"
       OR b."locationId" <> NEW."locationId"
       OR b."createdById" <> NEW."recordedById"
       OR b.status <> 'STAGED'
    THEN
        RAISE EXCEPTION
            'Correction posting batch identity mismatch';
    END IF;

    SELECT
        count(*),
        count(*) FILTER (
            WHERE "accountCode" = NEW."debitAccountCode"
              AND debit = NEW.amount
              AND credit = 0
        ),
        count(*) FILTER (
            WHERE "accountCode" = NEW."creditAccountCode"
              AND debit = 0
              AND credit = NEW.amount
        )
    INTO line_count, debit_count, credit_count
    FROM "FinancePostingLine"
    WHERE "batchId" = NEW."postingBatchId";

    IF line_count <> 2
       OR debit_count <> 1
       OR credit_count <> 1
    THEN
        RAISE EXCEPTION
            'Correction accounting lines do not balance';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER r103d24_correction_execution_guard
BEFORE INSERT OR UPDATE OR DELETE
ON "PosFinancialCorrectionExecution"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_correction_execution();