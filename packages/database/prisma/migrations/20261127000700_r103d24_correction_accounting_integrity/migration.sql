BEGIN;

-- R10_3D24_48D3F_ACCOUNTING_INTEGRITY

LOCK TABLE "FinancePostingBatch"
IN SHARE ROW EXCLUSIVE MODE;

LOCK TABLE "FinancePostingLine"
IN SHARE ROW EXCLUSIVE MODE;

LOCK TABLE "PosFinancialCorrectionExecution"
IN SHARE ROW EXCLUSIVE MODE;


-- One accounting batch per financial correction.

CREATE UNIQUE INDEX
    r103d24_unique_correction_posting_source
ON "FinancePostingBatch"("sourceId")
WHERE "sourceType" = 'POS_FINANCIAL_CORRECTION';


-- Reserved correction batch identity and immutability.

CREATE FUNCTION r103d24_guard_correction_batch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    c "PosFinancialCorrection"%ROWTYPE;
BEGIN

    IF TG_OP = 'DELETE' THEN

        IF OLD."sourceType" = 'POS_FINANCIAL_CORRECTION'
           OR OLD."idempotencyKey" LIKE 'POS_CORRECTION:%'
        THEN
            RAISE EXCEPTION
                'Correction accounting batches cannot be deleted';
        END IF;

        RETURN OLD;

    END IF;

    IF TG_OP = 'UPDATE' THEN

        IF OLD."sourceType" = 'POS_FINANCIAL_CORRECTION'
           OR NEW."sourceType" = 'POS_FINANCIAL_CORRECTION'
           OR OLD."idempotencyKey" LIKE 'POS_CORRECTION:%'
           OR NEW."idempotencyKey" LIKE 'POS_CORRECTION:%'
        THEN
            RAISE EXCEPTION
                'Correction accounting batch history is immutable';
        END IF;

        RETURN NEW;

    END IF;

    IF NEW."sourceType" <> 'POS_FINANCIAL_CORRECTION'
       AND NEW."idempotencyKey" LIKE 'POS_CORRECTION:%'
    THEN
        RAISE EXCEPTION
            'Reserved correction accounting namespace';
    END IF;

    IF NEW."sourceType" <> 'POS_FINANCIAL_CORRECTION' THEN
        RETURN NEW;
    END IF;

    IF NEW."sourceId" IS NULL THEN
        RAISE EXCEPTION
            'Correction source identity required';
    END IF;

    SELECT * INTO c
    FROM "PosFinancialCorrection"
    WHERE id = NEW."sourceId"
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Correction accounting source not found';
    END IF;

    IF c.status <> 'APPROVED'
       OR c."reviewedAt" IS NULL
       OR NEW."locationId" IS DISTINCT FROM c."locationId"
       OR NEW.status IS DISTINCT FROM 'STAGED'
       OR NEW."createdAt" < c."reviewedAt"
       OR NEW."idempotencyKey" IS DISTINCT FROM
           ('POS_CORRECTION:' || c.id::text)
    THEN
        RAISE EXCEPTION
            'Invalid correction accounting batch identity';
    END IF;

    RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_correction_batch_guard
BEFORE INSERT OR UPDATE OR DELETE
ON "FinancePostingBatch"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_correction_batch();


-- Correction posting lines cannot be rewritten.
-- Initial lines may be inserted before execution is recorded.

CREATE FUNCTION r103d24_guard_correction_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_id UUID;
    parent_type TEXT;
BEGIN

    IF TG_OP = 'UPDATE' THEN

        IF OLD."batchId" IS DISTINCT FROM NEW."batchId" THEN

            IF EXISTS (
                SELECT 1
                FROM "FinancePostingBatch"
                WHERE id IN (
                    OLD."batchId",
                    NEW."batchId"
                )
                AND "sourceType" = 'POS_FINANCIAL_CORRECTION'
            ) THEN
                RAISE EXCEPTION
                    'Correction accounting lines cannot be reassigned';
            END IF;

        END IF;

    END IF;

    IF TG_OP = 'DELETE' THEN
        parent_id := OLD."batchId";
    ELSE
        parent_id := NEW."batchId";
    END IF;

    SELECT "sourceType" INTO parent_type
    FROM "FinancePostingBatch"
    WHERE id = parent_id
    FOR UPDATE;

    IF NOT FOUND THEN

        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;

        RAISE EXCEPTION
            'Accounting batch not found';

    END IF;

    IF parent_type <> 'POS_FINANCIAL_CORRECTION' THEN

        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;

        RETURN NEW;

    END IF;

    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION
            'Correction accounting lines are immutable';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "PosFinancialCorrectionExecution"
        WHERE "postingBatchId" = parent_id
    ) THEN
        RAISE EXCEPTION
            'Correction accounting batch is already sealed';
    END IF;

    IF NEW.debit IS NULL
       OR NEW.credit IS NULL
       OR NOT (
           (NEW.debit > 0 AND NEW.credit = 0)
           OR
           (NEW.credit > 0 AND NEW.debit = 0)
       )
    THEN
        RAISE EXCEPTION
            'Invalid correction debit or credit line';
    END IF;

    RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_correction_line_guard
BEFORE INSERT OR UPDATE OR DELETE
ON "FinancePostingLine"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_correction_line();


-- Authoritative accounting verification.

CREATE FUNCTION r103d24_verify_correction_accounting(
    target_batch UUID
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    b "FinancePostingBatch"%ROWTYPE;
    e "PosFinancialCorrectionExecution"%ROWTYPE;
    c "PosFinancialCorrection"%ROWTYPE;
    total_lines BIGINT;
    valid_debits BIGINT;
    valid_credits BIGINT;
BEGIN

    SELECT * INTO b
    FROM "FinancePostingBatch"
    WHERE id = target_batch;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Correction accounting batch missing';
    END IF;

    IF b."sourceType" <> 'POS_FINANCIAL_CORRECTION' THEN
        RETURN;
    END IF;

    SELECT * INTO e
    FROM "PosFinancialCorrectionExecution"
    WHERE "postingBatchId" = b.id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Orphan correction accounting batch';
    END IF;

    SELECT * INTO c
    FROM "PosFinancialCorrection"
    WHERE id = e."correctionId";

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Correction accounting approval missing';
    END IF;

    IF c.status IS DISTINCT FROM 'APPROVED'
       OR b.status IS DISTINCT FROM 'STAGED'
       OR b."sourceId" IS DISTINCT FROM c.id
       OR b."locationId" IS DISTINCT FROM c."locationId"
       OR e."locationId" IS DISTINCT FROM c."locationId"
       OR e.amount IS DISTINCT FROM c.amount
       OR b."createdById" IS DISTINCT FROM e."recordedById"
       OR b."createdAt" IS DISTINCT FROM e."recordedAt"
       OR b."idempotencyKey" IS DISTINCT FROM
           ('POS_CORRECTION:' || c.id::text)
    THEN
        RAISE EXCEPTION
            'Correction accounting identity verification failed';
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
    FROM "FinancePostingLine"
    WHERE "batchId" = b.id;

    IF total_lines <> 2
       OR valid_debits <> 1
       OR valid_credits <> 1
    THEN
        RAISE EXCEPTION
            'Correction accounting integrity verification failed';
    END IF;

END;
$$;


-- A correction batch must have its execution record
-- before the transaction can commit.

CREATE FUNCTION r103d24_verify_correction_batch_commit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

    IF NEW."sourceType" = 'POS_FINANCIAL_CORRECTION' THEN

        PERFORM r103d24_verify_correction_accounting(
            NEW.id
        );

    END IF;

    RETURN NEW;

END;
$$;

CREATE CONSTRAINT TRIGGER r103d24_correction_batch_commit
AFTER INSERT
ON "FinancePostingBatch"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION r103d24_verify_correction_batch_commit();


-- Recheck accounting integrity after execution insertion.

CREATE FUNCTION r103d24_verify_correction_execution_commit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

    PERFORM r103d24_verify_correction_accounting(
        NEW."postingBatchId"
    );

    RETURN NEW;

END;
$$;

CREATE CONSTRAINT TRIGGER r103d24_correction_execution_commit
AFTER INSERT
ON "PosFinancialCorrectionExecution"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION r103d24_verify_correction_execution_commit();


-- Recheck final accounting line state at commit.

CREATE FUNCTION r103d24_verify_correction_line_commit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

    IF EXISTS (
        SELECT 1
        FROM "FinancePostingBatch"
        WHERE id = NEW."batchId"
          AND "sourceType" = 'POS_FINANCIAL_CORRECTION'
    ) THEN

        PERFORM r103d24_verify_correction_accounting(
            NEW."batchId"
        );

    END IF;

    RETURN NEW;

END;
$$;

CREATE CONSTRAINT TRIGGER r103d24_correction_line_commit
AFTER INSERT
ON "FinancePostingLine"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION r103d24_verify_correction_line_commit();


-- Prevent ordinary journal creation from impersonating
-- the dedicated correction accounting workflow.
-- Correction journal posting remains disabled.

CREATE FUNCTION r103d24_guard_correction_journal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

    IF TG_OP = 'UPDATE' THEN

        IF upper(btrim(OLD."sourceType")) =
                'POS_FINANCIAL_CORRECTION'
           OR upper(btrim(OLD."externalKey"))
                LIKE 'POS_CORRECTION:%'
        THEN
            RAISE EXCEPTION
                'Reserved correction journal history';
        END IF;

    END IF;

    IF upper(btrim(NEW."sourceType")) =
            'POS_FINANCIAL_CORRECTION'
       OR upper(btrim(NEW."externalKey"))
            LIKE 'POS_CORRECTION:%'
    THEN
        RAISE EXCEPTION
            'Dedicated correction journal posting is not enabled';
    END IF;

    RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_correction_journal_guard
BEFORE INSERT OR UPDATE
ON "FinanceJournal"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_correction_journal();

-- R10_3D24_48D3G1_NAMESPACE_NORMALIZATION

CREATE FUNCTION r103d24_guard_correction_namespace()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

    IF upper(btrim(NEW."sourceType")) =
            'POS_FINANCIAL_CORRECTION'
       OR upper(btrim(NEW."idempotencyKey"))
            LIKE 'POS_CORRECTION:%'
    THEN

        IF NEW."sourceType" IS DISTINCT FROM
                'POS_FINANCIAL_CORRECTION'
           OR NEW."idempotencyKey" IS DISTINCT FROM
                ('POS_CORRECTION:' || NEW."sourceId"::text)
        THEN

            RAISE EXCEPTION
                'Invalid reserved correction accounting namespace';

        END IF;

    END IF;

    RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_correction_namespace_guard
BEFORE INSERT OR UPDATE
ON "FinancePostingBatch"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_correction_namespace();

COMMIT;