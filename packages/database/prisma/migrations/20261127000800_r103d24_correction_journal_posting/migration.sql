BEGIN;

-- R10_3D24_48D3G2_CORRECTION_JOURNAL_POSTING

LOCK TABLE "FinanceJournal"
IN SHARE ROW EXCLUSIVE MODE;

LOCK TABLE "FinanceJournalLine"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "PosFinancialCorrectionPosting" (

    "id" UUID PRIMARY KEY,
    "correctionId" UUID NOT NULL UNIQUE,
    "executionId" UUID NOT NULL UNIQUE,
    "postingBatchId" UUID NOT NULL UNIQUE,
    "journalId" UUID NOT NULL UNIQUE,
    "locationId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "postedById" UUID NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postingNote" VARCHAR(1000) NOT NULL,

    CONSTRAINT r103d24_posting_amount
        CHECK ("amount" > 0),

    CONSTRAINT r103d24_posting_note
        CHECK (length(btrim("postingNote")) >= 10),

    CONSTRAINT r103d24_posting_correction_fk
        FOREIGN KEY ("correctionId")
        REFERENCES "PosFinancialCorrection"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT r103d24_posting_execution_fk
        FOREIGN KEY ("executionId")
        REFERENCES "PosFinancialCorrectionExecution"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT r103d24_posting_batch_fk
        FOREIGN KEY ("postingBatchId")
        REFERENCES "FinancePostingBatch"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT r103d24_posting_journal_fk
        FOREIGN KEY ("journalId")
        REFERENCES "FinanceJournal"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT r103d24_posting_actor_fk
        FOREIGN KEY ("postedById")
        REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT r103d24_posting_location_fk
        FOREIGN KEY ("locationId")
        REFERENCES "Location"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX
    "PosFinancialCorrectionPosting_locationId_postedAt_idx"
ON "PosFinancialCorrectionPosting"("locationId","postedAt");

CREATE UNIQUE INDEX r103d24_unique_correction_journal_source
ON "FinanceJournal"("sourceId")
WHERE "sourceType" = 'POS_FINANCIAL_CORRECTION';


-- Replace the previous absolute journal prohibition.
-- Only canonical correction journals are permitted.

CREATE OR REPLACE FUNCTION r103d24_guard_correction_journal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    c "PosFinancialCorrection"%ROWTYPE;
    e "PosFinancialCorrectionExecution"%ROWTYPE;
    i "PosPaymentReconciliation"%ROWTYPE;
BEGIN

    IF TG_OP <> 'INSERT' THEN

        IF upper(btrim(OLD."sourceType")) =
                'POS_FINANCIAL_CORRECTION'
           OR upper(btrim(OLD."externalKey"))
                LIKE 'POS_CORRECTION:%'
        THEN
            RAISE EXCEPTION
                'Correction journal history is immutable';
        END IF;

        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;

    END IF;

    IF upper(btrim(NEW."sourceType")) <>
            'POS_FINANCIAL_CORRECTION'
       AND upper(btrim(NEW."externalKey"))
            NOT LIKE 'POS_CORRECTION:%'
    THEN
        RETURN NEW;
    END IF;

    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION
            'Journal cannot be converted into a correction journal';
    END IF;

    IF NEW."sourceType" IS DISTINCT FROM
            'POS_FINANCIAL_CORRECTION'
       OR NEW."sourceId" IS NULL
       OR NEW."sourceId" !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NEW."externalKey" IS DISTINCT FROM
            ('POS_CORRECTION:' || NEW."sourceId")
       OR NEW.status::text <> 'POSTED'
       OR NEW."reversedById" IS NOT NULL
       OR NEW."reversedAt" IS NOT NULL
       OR NEW."reversalReason" IS NOT NULL
    THEN
        RAISE EXCEPTION
            'Invalid correction journal identity';
    END IF;

    LOCK TABLE "FinancePeriodLock" IN SHARE MODE;

    SELECT * INTO c
    FROM "PosFinancialCorrection"
    WHERE id = NEW."sourceId"::uuid
    FOR UPDATE;

    IF NOT FOUND OR c.status <> 'APPROVED' THEN
        RAISE EXCEPTION
            'Approved financial correction required';
    END IF;

    SELECT * INTO e
    FROM "PosFinancialCorrectionExecution"
    WHERE "correctionId" = c.id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Verified correction execution required';
    END IF;

    SELECT * INTO STRICT i
    FROM "PosPaymentReconciliation"
    WHERE id = c."investigationId";

    PERFORM r103d24_verify_correction_accounting(
        e."postingBatchId"
    );

    IF NEW."locationId" IS DISTINCT FROM c."locationId"
       OR NEW."createdAt" < e."recordedAt"
       OR NEW."createdAt" >
            clock_timestamp() AT TIME ZONE 'UTC'
       OR NEW."createdById" = e."recordedById"
       OR NEW."createdById" = c."submittedById"
       OR NEW."createdById" = i."paymentOperatorId"
    THEN
        RAISE EXCEPTION
            'Correction journal authorization mismatch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "FinancePeriodLock" p
        WHERE p."locationId" = NEW."locationId"
          AND p."periodStart" <= NEW."createdAt"
          AND p."periodEnd" > NEW."createdAt"
    ) THEN
        RAISE EXCEPTION
            'Correction journal accounting period is locked';
    END IF;

    RETURN NEW;

END;
$$;

DROP TRIGGER r103d24_correction_journal_guard
ON "FinanceJournal";

CREATE TRIGGER r103d24_correction_journal_guard
BEFORE INSERT OR UPDATE OR DELETE
ON "FinanceJournal"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_correction_journal();


-- Protect journal lines from subsequent modification.

CREATE FUNCTION r103d24_guard_correction_journal_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_id UUID;
    parent_type TEXT;
BEGIN

    IF TG_OP = 'UPDATE' THEN

        IF EXISTS (
            SELECT 1
            FROM "FinanceJournal"
            WHERE id IN (
                OLD."journalId",
                NEW."journalId"
            )
            AND "sourceType" = 'POS_FINANCIAL_CORRECTION'
        ) THEN
            RAISE EXCEPTION
                'Correction journal lines are immutable';
        END IF;

        RETURN NEW;

    END IF;

    IF TG_OP = 'DELETE' THEN
        parent_id := OLD."journalId";
    ELSE
        parent_id := NEW."journalId";
    END IF;

    SELECT "sourceType" INTO parent_type
    FROM "FinanceJournal"
    WHERE id = parent_id
    FOR UPDATE;

    IF parent_type = 'POS_FINANCIAL_CORRECTION' THEN

        IF TG_OP <> 'INSERT' THEN
            RAISE EXCEPTION
                'Correction journal lines cannot be deleted';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM "PosFinancialCorrectionPosting"
            WHERE "journalId" = parent_id
        ) THEN
            RAISE EXCEPTION
                'Correction journal has already been sealed';
        END IF;

    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_correction_journal_line_guard
BEFORE INSERT OR UPDATE OR DELETE
ON "FinanceJournalLine"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_correction_journal_line();


-- Verify the complete correction-to-journal relationship.

CREATE FUNCTION r103d24_verify_correction_journal(
    target_journal UUID
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    j "FinanceJournal"%ROWTYPE;
    p "PosFinancialCorrectionPosting"%ROWTYPE;
    e "PosFinancialCorrectionExecution"%ROWTYPE;
    c "PosFinancialCorrection"%ROWTYPE;
    i "PosPaymentReconciliation"%ROWTYPE;
    total_lines BIGINT;
    valid_debits BIGINT;
    valid_credits BIGINT;
BEGIN

    SELECT * INTO STRICT j
    FROM "FinanceJournal"
    WHERE id = target_journal;

    IF j."sourceType" <> 'POS_FINANCIAL_CORRECTION' THEN
        RETURN;
    END IF;

    SELECT * INTO STRICT p
    FROM "PosFinancialCorrectionPosting"
    WHERE "journalId" = j.id;

    SELECT * INTO STRICT e
    FROM "PosFinancialCorrectionExecution"
    WHERE id = p."executionId";

    SELECT * INTO STRICT c
    FROM "PosFinancialCorrection"
    WHERE id = p."correctionId";

    SELECT * INTO STRICT i
    FROM "PosPaymentReconciliation"
    WHERE id = c."investigationId";

    PERFORM r103d24_verify_correction_accounting(
        e."postingBatchId"
    );

    IF c.status <> 'APPROVED'
       OR e."correctionId" IS DISTINCT FROM c.id
       OR p."postingBatchId" IS DISTINCT FROM e."postingBatchId"
       OR p."locationId" IS DISTINCT FROM c."locationId"
       OR p.amount IS DISTINCT FROM c.amount
       OR j."locationId" IS DISTINCT FROM c."locationId"
       OR j."sourceId" IS DISTINCT FROM c.id::text
       OR j."externalKey" IS DISTINCT FROM
            ('POS_CORRECTION:' || c.id::text)
       OR j.status::text <> 'POSTED'
       OR j."createdById" IS DISTINCT FROM p."postedById"
       OR j."createdAt" IS DISTINCT FROM p."postedAt"
       OR p."postedAt" < e."recordedAt"
       OR p."postedById" = e."recordedById"
       OR p."postedById" = c."submittedById"
       OR p."postedById" = i."paymentOperatorId"
    THEN
        RAISE EXCEPTION
            'Correction journal posting integrity failure';
    END IF;

    SELECT
        count(*),
        count(*) FILTER (
            WHERE "accountCode" = e."debitAccountCode"
              AND debit = c.amount
              AND credit = 0
        ),
        count(*) FILTER (
            WHERE "accountCode" = e."creditAccountCode"
              AND debit = 0
              AND credit = c.amount
        )
    INTO total_lines, valid_debits, valid_credits
    FROM "FinanceJournalLine"
    WHERE "journalId" = j.id;

    IF total_lines <> 2
       OR valid_debits <> 1
       OR valid_credits <> 1
    THEN
        RAISE EXCEPTION
            'Correction journal accounting balance failure';
    END IF;

END;
$$;


-- Posting records cannot be rewritten.

CREATE FUNCTION r103d24_guard_correction_posting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION
            'Correction posting history is immutable';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "FinanceJournal"
        WHERE id = NEW."journalId"
          AND "sourceType" = 'POS_FINANCIAL_CORRECTION'
          AND "sourceId" = NEW."correctionId"::text
    ) THEN
        RAISE EXCEPTION
            'Canonical correction journal required';
    END IF;

    RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_correction_posting_guard
BEFORE INSERT OR UPDATE OR DELETE
ON "PosFinancialCorrectionPosting"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_correction_posting();


-- A journal and its posting register must commit together.

CREATE FUNCTION r103d24_correction_journal_commit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

    PERFORM r103d24_verify_correction_journal(NEW.id);

    RETURN NEW;

END;
$$;

CREATE CONSTRAINT TRIGGER r103d24_correction_journal_commit
AFTER INSERT
ON "FinanceJournal"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION r103d24_correction_journal_commit();


CREATE FUNCTION r103d24_correction_posting_commit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

    PERFORM r103d24_verify_correction_journal(
        NEW."journalId"
    );

    RETURN NEW;

END;
$$;

CREATE CONSTRAINT TRIGGER r103d24_correction_posting_commit
AFTER INSERT
ON "PosFinancialCorrectionPosting"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION r103d24_correction_posting_commit();


CREATE CONSTRAINT TRIGGER r103d24_correction_journal_line_commit
AFTER INSERT
ON "FinanceJournalLine"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION r103d24_correction_posting_commit();

COMMIT;
