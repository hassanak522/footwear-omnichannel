BEGIN;

CREATE TABLE "PosFinancialCorrectionRelease" (
    "id" UUID NOT NULL,
    "correctionId" UUID NOT NULL,
    "closureId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "releasedById" UUID NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP,
    "releaseNote" VARCHAR(1000) NOT NULL,

    CONSTRAINT "PosFinancialCorrectionRelease_pkey"
        PRIMARY KEY ("id"),

    CONSTRAINT "PosFinancialCorrectionRelease_correctionId_key"
        UNIQUE ("correctionId"),

    CONSTRAINT "PosFinancialCorrectionRelease_closureId_key"
        UNIQUE ("closureId"),

    CONSTRAINT "PosFinancialCorrectionRelease_amount_check"
        CHECK ("amount" > 0),

    CONSTRAINT "PosFinancialCorrectionRelease_note_check"
        CHECK (length(btrim("releaseNote")) >= 20),

    CONSTRAINT "PosFinancialCorrectionRelease_correctionId_fkey"
        FOREIGN KEY ("correctionId")
        REFERENCES "PosFinancialCorrection"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "PosFinancialCorrectionRelease_closureId_fkey"
        FOREIGN KEY ("closureId")
        REFERENCES "PosFinancialCorrectionClosure"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "PosFinancialCorrectionRelease_locationId_fkey"
        FOREIGN KEY ("locationId")
        REFERENCES "Location"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "PosFinancialCorrectionRelease_releasedById_fkey"
        FOREIGN KEY ("releasedById")
        REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX
    "PosFinancialCorrectionRelease_locationId_releasedAt_idx"
ON "PosFinancialCorrectionRelease"(
    "locationId","releasedAt"
);

CREATE FUNCTION r103d24_guard_correction_release()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    c "PosFinancialCorrection"%ROWTYPE;
    cl "PosFinancialCorrectionClosure"%ROWTYPE;
    e "PosFinancialCorrectionExecution"%ROWTYPE;
    p "PosFinancialCorrectionPosting"%ROWTYPE;
    i "PosPaymentReconciliation"%ROWTYPE;
    r "PosRefundAttempt"%ROWTYPE;
    x "PosExchangeAttempt"%ROWTYPE;
BEGIN

    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION
            'Financial correction release is immutable';
    END IF;

    SELECT * INTO STRICT c
    FROM "PosFinancialCorrection"
    WHERE id = NEW."correctionId"
    FOR UPDATE;

    SELECT * INTO STRICT cl
    FROM "PosFinancialCorrectionClosure"
    WHERE id = NEW."closureId";

    SELECT * INTO STRICT e
    FROM "PosFinancialCorrectionExecution"
    WHERE id = cl."executionId";

    SELECT * INTO STRICT p
    FROM "PosFinancialCorrectionPosting"
    WHERE id = cl."postingId";

    SELECT * INTO STRICT i
    FROM "PosPaymentReconciliation"
    WHERE id = c."investigationId";

    PERFORM r103d24_verify_correction_journal(
        p."journalId"
    );

    IF c.status <> 'APPROVED'
       OR i.status <> 'APPROVED'
       OR i."executionAbandoned" IS DISTINCT FROM TRUE
       OR cl."correctionId" IS DISTINCT FROM c.id
       OR e."correctionId" IS DISTINCT FROM c.id
       OR p."correctionId" IS DISTINCT FROM c.id
       OR p."executionId" IS DISTINCT FROM e.id
       OR NEW."locationId" IS DISTINCT FROM c."locationId"
       OR NEW.amount IS DISTINCT FROM c.amount
       OR NEW."releasedAt" < cl."authorizedAt"
       OR NEW."releasedAt" >
           clock_timestamp() AT TIME ZONE 'UTC'
       OR NEW."releasedById" = cl."authorizedById"
       OR NEW."releasedById" = c."submittedById"
       OR NEW."releasedById" = i."paymentOperatorId"
       OR NEW."releasedById" = e."recordedById"
       OR NEW."releasedById" = p."postedById"
    THEN
        RAISE EXCEPTION
            'Financial correction release integrity failure';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "PosPaymentReconciliation" pending
        WHERE pending.status = 'PENDING'
          AND (
              pending."refundAttemptId" = c."refundAttemptId"
              OR
              pending."exchangeAttemptId" = c."exchangeAttemptId"
          )
    ) THEN
        RAISE EXCEPTION
            'Competing payment investigation remains pending';
    END IF;

    IF c."correctionType" = 'CONTRADICTORY_REFUND_PAYMENT' THEN

        SELECT * INTO STRICT r
        FROM "PosRefundAttempt"
        WHERE id = c."refundAttemptId";

        IF r.status <> 'RESOLVED_NO_PAYMENT'
           OR r."paymentState" <> 'NOT_PAID'
           OR r."settlementId" IS NOT NULL
           OR r."payloadHash" IS DISTINCT FROM c."payloadHash"
           OR r."locationId" IS DISTINCT FROM c."locationId"
           OR r.amount IS DISTINCT FROM c.amount
        THEN
            RAISE EXCEPTION
                'Original refund state requires reconciliation';
        END IF;

    ELSIF c."correctionType" IN (
        'CONTRADICTORY_EXCHANGE_COLLECTION',
        'UNRESOLVED_EXCHANGE_REVERSAL'
    ) THEN

        SELECT * INTO STRICT x
        FROM "PosExchangeAttempt"
        WHERE id = c."exchangeAttemptId";

        IF x."payloadHash" IS DISTINCT FROM c."payloadHash"
           OR x."locationId" IS DISTINCT FROM c."locationId"
           OR x."shiftId" IS DISTINCT FROM c."originalShiftId"
           OR x."deviceId" IS DISTINCT FROM c."originalDeviceId"
        THEN
            RAISE EXCEPTION
                'Original exchange identity mismatch';
        END IF;

        IF c."correctionType" =
            'CONTRADICTORY_EXCHANGE_COLLECTION'
        THEN

            IF x.status <> 'RESOLVED_NO_EXCHANGE'
               OR x."paymentState" <> 'NOT_COLLECTED'
               OR x."reversalStatus" <> 'NONE'
            THEN
                RAISE EXCEPTION
                    'Original collection state mismatch';
            END IF;

        ELSE

            IF x.status NOT IN ('REGISTERED','UNKNOWN')
               OR x."paymentState" <> 'CONFIRMED'
               OR x."reversalStatus" <> 'AUTHORIZED'
            THEN
                RAISE EXCEPTION
                    'Original reversal state mismatch';
            END IF;

        END IF;

    ELSE

        RAISE EXCEPTION
            'Unsupported financial correction type';

    END IF;

    -- R10_3D24_48D3G4C_RELEASE_ACTIVATION_GUARD
    -- Release remains prohibited until authoritative
    -- operational reconciliation controls are installed.

    RAISE EXCEPTION
        'Financial release integration is not yet complete';

    RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_correction_release_guard
BEFORE INSERT OR UPDATE OR DELETE
ON "PosFinancialCorrectionRelease"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_correction_release();

COMMIT;
