BEGIN;

-- R10_3D24_48D_FINANCIAL_CORRECTION_REGISTER

CREATE TABLE "PosFinancialCorrection" (
    "id" UUID NOT NULL,
    "investigationId" UUID NOT NULL,
    "refundAttemptId" UUID,
    "exchangeAttemptId" UUID,
    "locationId" UUID NOT NULL,
    "originalShiftId" UUID NOT NULL,
    "originalDeviceId" UUID NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "correctionType" VARCHAR(40) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "evidenceReference" VARCHAR(200) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "submittedById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" VARCHAR(1000),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosFinancialCorrection_pkey"
        PRIMARY KEY ("id"),

    CONSTRAINT "r103d24_correction_investigation_fk"
        FOREIGN KEY ("investigationId")
        REFERENCES "PosPaymentReconciliation"(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "r103d24_correction_refund_fk"
        FOREIGN KEY ("refundAttemptId")
        REFERENCES "PosRefundAttempt"(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "r103d24_correction_exchange_fk"
        FOREIGN KEY ("exchangeAttemptId")
        REFERENCES "PosExchangeAttempt"(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "r103d24_correction_location_fk"
        FOREIGN KEY ("locationId")
        REFERENCES "Location"(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "r103d24_correction_shift_fk"
        FOREIGN KEY ("originalShiftId")
        REFERENCES "PosShift"(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "r103d24_correction_device_fk"
        FOREIGN KEY ("originalDeviceId")
        REFERENCES "PosDevice"(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "r103d24_correction_submitter_fk"
        FOREIGN KEY ("submittedById")
        REFERENCES "User"(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "r103d24_correction_reviewer_fk"
        FOREIGN KEY ("reviewedById")
        REFERENCES "User"(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT "r103d24_correction_amount"
        CHECK ("amount" > 0),

    CONSTRAINT "r103d24_correction_identity"
        CHECK (
            (
                "refundAttemptId" IS NOT NULL
                AND "exchangeAttemptId" IS NULL
                AND "correctionType" =
                    'CONTRADICTORY_REFUND_PAYMENT'
            )
            OR
            (
                "refundAttemptId" IS NULL
                AND "exchangeAttemptId" IS NOT NULL
                AND "correctionType" IN (
                    'CONTRADICTORY_EXCHANGE_COLLECTION',
                    'UNRESOLVED_EXCHANGE_REVERSAL'
                )
            )
        ),

    CONSTRAINT "r103d24_correction_evidence"
        CHECK (
            length(btrim("payloadHash")) > 0
            AND length(btrim("evidenceReference")) >= 5
            AND length(btrim("reason")) >= 10
        ),

    CONSTRAINT "r103d24_correction_review_state"
        CHECK (
            (
                status = 'PENDING'
                AND "reviewedById" IS NULL
                AND "reviewedAt" IS NULL
                AND "reviewNote" IS NULL
            )
            OR
            (
                status IN ('APPROVED','REJECTED')
                AND "reviewedById" IS NOT NULL
                AND "reviewedAt" IS NOT NULL
                AND "reviewNote" IS NOT NULL
                AND length(btrim("reviewNote")) >= 10
                AND "reviewedById" <> "submittedById"
                AND "reviewedAt" >= "submittedAt"
            )
        )
);

CREATE INDEX "PosFinancialCorrection_investigationId_status_idx"
ON "PosFinancialCorrection" ("investigationId", status);

CREATE INDEX "PosFinancialCorrection_locationId_status_submittedAt_idx"
ON "PosFinancialCorrection" ("locationId", status, "submittedAt");

CREATE INDEX "PosFinancialCorrection_refundAttemptId_status_idx"
ON "PosFinancialCorrection" ("refundAttemptId", status);

CREATE INDEX "PosFinancialCorrection_exchangeAttemptId_status_idx"
ON "PosFinancialCorrection" ("exchangeAttemptId", status);


-- A rejected proposal may be replaced with new evidence.
-- An approved or pending proposal prevents duplication.

CREATE UNIQUE INDEX r103d24_active_correction_investigation
ON "PosFinancialCorrection" ("investigationId")
WHERE status IN ('PENDING','APPROVED');

CREATE UNIQUE INDEX r103d24_active_refund_correction
ON "PosFinancialCorrection" ("refundAttemptId")
WHERE "refundAttemptId" IS NOT NULL
AND status IN ('PENDING','APPROVED');

CREATE UNIQUE INDEX r103d24_active_exchange_correction
ON "PosFinancialCorrection" ("exchangeAttemptId")
WHERE "exchangeAttemptId" IS NOT NULL
AND status IN ('PENDING','APPROVED');


CREATE FUNCTION r103d24_financial_correction_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    investigation "PosPaymentReconciliation"%ROWTYPE;
    refund "PosRefundAttempt"%ROWTYPE;
    exchange "PosExchangeAttempt"%ROWTYPE;
BEGIN

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'Financial correction history cannot be deleted';
    END IF;

    IF TG_OP = 'INSERT' THEN

        IF NEW.status <> 'PENDING' THEN
            RAISE EXCEPTION
                'Financial corrections must begin pending review';
        END IF;

    ELSE

        IF OLD.status <> 'PENDING' THEN
            RAISE EXCEPTION
                'Reviewed correction history is immutable';
        END IF;

        IF NEW.status NOT IN ('APPROVED','REJECTED') THEN
            RAISE EXCEPTION
                'Invalid financial correction transition';
        END IF;

        IF (
            to_jsonb(OLD) -
            ARRAY[
                'status',
                'reviewedById',
                'reviewedAt',
                'reviewNote',
                'updatedAt'
            ]
        ) IS DISTINCT FROM (
            to_jsonb(NEW) -
            ARRAY[
                'status',
                'reviewedById',
                'reviewedAt',
                'reviewNote',
                'updatedAt'
            ]
        ) THEN
            RAISE EXCEPTION
                'Original correction proposal is immutable';
        END IF;

    END IF;

    SELECT * INTO investigation
    FROM "PosPaymentReconciliation"
    WHERE id = NEW."investigationId"
    FOR UPDATE;

    IF NOT FOUND
       OR investigation.status <> 'APPROVED'
       OR investigation."executionAbandoned" IS NOT TRUE
       OR investigation."refundAttemptId"
          IS DISTINCT FROM NEW."refundAttemptId"
       OR investigation."exchangeAttemptId"
          IS DISTINCT FROM NEW."exchangeAttemptId"
       OR investigation."locationId"
          IS DISTINCT FROM NEW."locationId"
       OR investigation."shiftId"
          IS DISTINCT FROM NEW."originalShiftId"
       OR investigation."deviceId"
          IS DISTINCT FROM NEW."originalDeviceId"
       OR investigation."payloadHash"
          IS DISTINCT FROM NEW."payloadHash"
       OR investigation.amount
          IS DISTINCT FROM NEW.amount
    THEN
        RAISE EXCEPTION
            'Correction must match approved abandoned investigation';
    END IF;

    IF lower(btrim(NEW."evidenceReference")) =
       lower(btrim(investigation."evidenceReference"))
    THEN
        RAISE EXCEPTION
            'New independent correction evidence required';
    END IF;

    IF NEW.status IN ('APPROVED','REJECTED') THEN

        IF NEW."reviewedById" =
           investigation."paymentOperatorId"
           OR NEW."reviewedById" =
              investigation."submittedById"
           OR NEW."reviewedById" =
              investigation."reviewedById"
        THEN
            RAISE EXCEPTION
                'Independent correction reviewer required';
        END IF;

    END IF;

    IF NEW."correctionType" =
       'CONTRADICTORY_REFUND_PAYMENT'
    THEN

        SELECT * INTO refund
        FROM "PosRefundAttempt"
        WHERE id = NEW."refundAttemptId"
        FOR UPDATE;

        IF NOT FOUND
           OR investigation.kind <> 'REFUND_PAYOUT'
           OR investigation."proposedOutcome" <> 'NOT_PAID'
           OR refund."payloadHash"
              IS DISTINCT FROM NEW."payloadHash"
           OR refund."locationId"
              IS DISTINCT FROM NEW."locationId"
           OR refund."shiftId"
              IS DISTINCT FROM NEW."originalShiftId"
           OR refund."deviceId"
              IS DISTINCT FROM NEW."originalDeviceId"
           OR refund.amount IS DISTINCT FROM NEW.amount
        THEN
            RAISE EXCEPTION
                'Refund correction identity mismatch';
        END IF;

        IF NEW.status <> 'REJECTED'
           AND (
               refund.status <> 'RESOLVED_NO_PAYMENT'
               OR refund."paymentState" <> 'NOT_PAID'
               OR refund."settlementId" IS NOT NULL
           )
        THEN
            RAISE EXCEPTION
                'Refund no-payment resolution required';
        END IF;

    ELSE

        SELECT * INTO exchange
        FROM "PosExchangeAttempt"
        WHERE id = NEW."exchangeAttemptId"
        FOR UPDATE;

        IF NOT FOUND
           OR exchange."payloadHash"
              IS DISTINCT FROM NEW."payloadHash"
           OR exchange."locationId"
              IS DISTINCT FROM NEW."locationId"
           OR exchange."shiftId"
              IS DISTINCT FROM NEW."originalShiftId"
           OR exchange."deviceId"
              IS DISTINCT FROM NEW."originalDeviceId"
        THEN
            RAISE EXCEPTION
                'Exchange correction identity mismatch';
        END IF;

        IF NEW."correctionType" =
           'CONTRADICTORY_EXCHANGE_COLLECTION'
        THEN

            IF investigation.kind <> 'EXCHANGE_COLLECTION'
               OR investigation."proposedOutcome"
                  <> 'NOT_COLLECTED'
            THEN
                RAISE EXCEPTION
                    'Collection investigation required';
            END IF;

            IF NEW.status <> 'REJECTED'
               AND (
                   exchange.status <> 'RESOLVED_NO_EXCHANGE'
                   OR exchange."paymentState" <> 'NOT_COLLECTED'
                   OR exchange."reversalStatus" <> 'NONE'
               )
            THEN
                RAISE EXCEPTION
                    'Uncollected exchange resolution required';
            END IF;

        ELSIF NEW."correctionType" =
              'UNRESOLVED_EXCHANGE_REVERSAL'
        THEN

            IF investigation.kind <> 'EXCHANGE_REVERSAL'
               OR investigation."proposedOutcome"
                  <> 'NOT_REVERSED'
            THEN
                RAISE EXCEPTION
                    'Abandoned reversal investigation required';
            END IF;

            IF NEW.status <> 'REJECTED'
               AND (
                   exchange.status NOT IN ('REGISTERED','UNKNOWN')
                   OR exchange."paymentState" <> 'CONFIRMED'
                   OR exchange."reversalStatus" <> 'AUTHORIZED'
               )
            THEN
                RAISE EXCEPTION
                    'Unresolved reversal hold required';
            END IF;

        END IF;

    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER r103d24_financial_correction_history
BEFORE INSERT OR UPDATE OR DELETE
ON "PosFinancialCorrection"
FOR EACH ROW
EXECUTE FUNCTION r103d24_financial_correction_guard();

COMMIT;
