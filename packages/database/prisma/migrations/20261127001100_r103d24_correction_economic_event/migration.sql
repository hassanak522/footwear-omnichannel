BEGIN;

CREATE TABLE "PosFinancialCorrectionEconomicEvent" (
    "id" UUID NOT NULL,
    "correctionId" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "originalShiftId" UUID NOT NULL,
    "economicEventAt" TIMESTAMP(3) NOT NULL,
    "direction" VARCHAR(16) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "cashAmount" DECIMAL(12,2) NOT NULL,
    "cardAmount" DECIMAL(12,2) NOT NULL,
    "otherAmount" DECIMAL(12,2) NOT NULL,
    "evidenceReference" VARCHAR(200) NOT NULL,
    "evidenceNote" VARCHAR(1000) NOT NULL,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosFinancialCorrectionEconomicEvent_pkey"
        PRIMARY KEY ("id"),

    CONSTRAINT "PosFinancialCorrectionEconomicEvent_correctionId_key"
        UNIQUE ("correctionId"),

    CONSTRAINT "PosFinancialCorrectionEconomicEvent_executionId_key"
        UNIQUE ("executionId"),

    CONSTRAINT "PosCorrectionEconomicEvent_correction_fkey"
        FOREIGN KEY ("correctionId")
        REFERENCES "PosFinancialCorrection"("id")
        ON DELETE RESTRICT,

    CONSTRAINT "PosCorrectionEconomicEvent_execution_fkey"
        FOREIGN KEY ("executionId")
        REFERENCES "PosFinancialCorrectionExecution"("id")
        ON DELETE RESTRICT,

    CONSTRAINT "PosCorrectionEconomicEvent_location_fkey"
        FOREIGN KEY ("locationId")
        REFERENCES "Location"("id")
        ON DELETE RESTRICT,

    CONSTRAINT "PosCorrectionEconomicEvent_shift_fkey"
        FOREIGN KEY ("originalShiftId")
        REFERENCES "PosShift"("id")
        ON DELETE RESTRICT,

    CONSTRAINT "PosCorrectionEconomicEvent_recorder_fkey"
        FOREIGN KEY ("recordedById")
        REFERENCES "User"("id")
        ON DELETE RESTRICT,

    CONSTRAINT "PosCorrectionEconomicEvent_amount_check"
        CHECK (
            "amount" > 0
            AND "cashAmount" >= 0
            AND "cardAmount" >= 0
            AND "otherAmount" >= 0
            AND "amount" =
                "cashAmount" +
                "cardAmount" +
                "otherAmount"
        ),

    CONSTRAINT "PosCorrectionEconomicEvent_direction_check"
        CHECK ("direction" IN ('INFLOW','OUTFLOW')),

    CONSTRAINT "PosCorrectionEconomicEvent_evidence_check"
        CHECK (
            length(btrim("evidenceReference")) >= 5
            AND length(btrim("evidenceNote")) >= 20
        ),

    CONSTRAINT "PosCorrectionEconomicEvent_chronology_check"
        CHECK ("economicEventAt" <= "recordedAt")
);

CREATE INDEX "PosCorrectionEconomicEvent_location_date_idx"
ON "PosFinancialCorrectionEconomicEvent"
("locationId","economicEventAt");

CREATE INDEX "PosCorrectionEconomicEvent_shift_idx"
ON "PosFinancialCorrectionEconomicEvent"
("originalShiftId");

CREATE FUNCTION r103d24_guard_economic_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    c "PosFinancialCorrection"%ROWTYPE;
    e "PosFinancialCorrectionExecution"%ROWTYPE;
    i "PosPaymentReconciliation"%ROWTYPE;
    s "PosShift"%ROWTYPE;
    r "PosRefundAttempt"%ROWTYPE;
    x "PosExchangeAttempt"%ROWTYPE;
    tender JSONB;
    tender_type TEXT;
    tender_amount NUMERIC;
    cash_total NUMERIC := 0;
    card_total NUMERIC := 0;
    other_total NUMERIC := 0;
BEGIN

    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION
            'Economic event evidence is immutable';
    END IF;

    SELECT * INTO STRICT c
    FROM "PosFinancialCorrection"
    WHERE id = NEW."correctionId"
    FOR UPDATE;

    SELECT * INTO STRICT e
    FROM "PosFinancialCorrectionExecution"
    WHERE id = NEW."executionId";

    SELECT * INTO STRICT i
    FROM "PosPaymentReconciliation"
    WHERE id = c."investigationId";

    SELECT * INTO STRICT s
    FROM "PosShift"
    WHERE id = c."originalShiftId";

    IF c.status <> 'APPROVED'
       OR i.status <> 'APPROVED'
       OR i."executionAbandoned" IS DISTINCT FROM TRUE
       OR e."correctionId" <> c.id
       OR e."locationId" <> c."locationId"
       OR e.amount <> c.amount
       OR NEW."locationId" <> c."locationId"
       OR NEW."originalShiftId" <> c."originalShiftId"
       OR NEW.amount <> c.amount
       OR s."locationId" <> c."locationId"
       OR s."deviceId" <> c."originalDeviceId"
    THEN
        RAISE EXCEPTION
            'Economic event identity mismatch';
    END IF;

    IF NEW."recordedAt" < e."recordedAt"
       OR NEW."recordedAt" >
          (clock_timestamp() AT TIME ZONE 'UTC')
       OR NEW."economicEventAt" < s."openedAt"
       OR NEW."economicEventAt" > e."recordedAt"
    THEN
        RAISE EXCEPTION
            'Economic event chronology invalid';
    END IF;

    IF NEW."recordedById" = i."paymentOperatorId"
       OR NEW."recordedById" = c."submittedById"
       OR NEW."recordedById" = e."recordedById"
    THEN
        RAISE EXCEPTION
            'Independent economic event recorder required';
    END IF;

    IF lower(btrim(NEW."evidenceReference")) =
       lower(btrim(i."evidenceReference"))
    THEN
        RAISE EXCEPTION
            'Contradictory evidence cannot be reused';
    END IF;

    IF c."correctionType" =
       'CONTRADICTORY_REFUND_PAYMENT'
    THEN

        IF NEW.direction <> 'OUTFLOW' THEN
            RAISE EXCEPTION
                'Refund correction requires outflow';
        END IF;

        SELECT * INTO STRICT r
        FROM "PosRefundAttempt"
        WHERE id = c."refundAttemptId";

        IF r.amount <> NEW.amount
           OR r."locationId" <> NEW."locationId"
           OR r."shiftId" <> NEW."originalShiftId"
           OR r."payloadHash" <> c."payloadHash"
        THEN
            RAISE EXCEPTION
                'Refund economic event identity mismatch';
        END IF;

        IF NEW."economicEventAt" < r."createdAt" THEN
            RAISE EXCEPTION
                'Economic event predates refund registration';
        END IF;

        IF NOT (
            (r.method::text = 'CASH'
             AND NEW."cashAmount" = NEW.amount)
            OR
            (r.method::text = 'CARD'
             AND NEW."cardAmount" = NEW.amount)
            OR
            (r.method::text = 'OTHER'
             AND NEW."otherAmount" = NEW.amount)
        ) THEN
            RAISE EXCEPTION
                'Refund tender allocation mismatch';
        END IF;

    ELSIF c."correctionType" =
          'CONTRADICTORY_EXCHANGE_COLLECTION'
    THEN

        IF NEW.direction <> 'INFLOW' THEN
            RAISE EXCEPTION
                'Exchange collection requires inflow';
        END IF;

    ELSIF c."correctionType" =
          'UNRESOLVED_EXCHANGE_REVERSAL'
    THEN

        IF NEW.direction <> 'OUTFLOW' THEN
            RAISE EXCEPTION
                'Exchange reversal requires outflow';
        END IF;

    ELSE

        RAISE EXCEPTION
            'Unsupported financial correction type';

    END IF;

    -- R10_3D24_48D3G4D2C_EXCHANGE_TENDER

    IF c."correctionType" IN (
        'CONTRADICTORY_EXCHANGE_COLLECTION',
        'UNRESOLVED_EXCHANGE_REVERSAL'
    ) THEN

        SELECT * INTO STRICT x
        FROM "PosExchangeAttempt"
        WHERE id = c."exchangeAttemptId";

        IF x."locationId" <> c."locationId"
           OR x."deviceId" <> c."originalDeviceId"
           OR x."shiftId" <> c."originalShiftId"
           OR x."payloadHash" <> c."payloadHash"
           OR NEW."economicEventAt" < x."createdAt"
        THEN
            RAISE EXCEPTION
                'Exchange economic event identity mismatch';
        END IF;

        IF c."correctionType" =
           'CONTRADICTORY_EXCHANGE_COLLECTION'
        THEN
            IF x.status <> 'RESOLVED_NO_EXCHANGE'
               OR x."paymentState" <> 'NOT_COLLECTED'
               OR x."reversalStatus" <> 'NONE'
            THEN
                RAISE EXCEPTION
                    'Exchange collection state mismatch';
            END IF;
        ELSE
            IF x.status NOT IN ('REGISTERED','UNKNOWN')
               OR x."paymentState" <> 'CONFIRMED'
               OR x."reversalStatus" <> 'AUTHORIZED'
            THEN
                RAISE EXCEPTION
                    'Exchange reversal state mismatch';
            END IF;
        END IF;

        IF jsonb_typeof(
            x.payload->'additionalTenders'
        ) IS DISTINCT FROM 'array'
        THEN
            RAISE EXCEPTION
                'Exchange tender payload missing';
        END IF;

        IF jsonb_array_length(
            x.payload->'additionalTenders'
        ) NOT BETWEEN 1 AND 10
        THEN
            RAISE EXCEPTION
                'Invalid exchange tender count';
        END IF;

        FOR tender IN
            SELECT value
            FROM jsonb_array_elements(
                x.payload->'additionalTenders'
            )
        LOOP

            tender_type := tender->>'type';

            IF tender_type IS NULL
               OR tender_type NOT IN (
                   'CASH','CARD','OTHER'
               )
            THEN
                RAISE EXCEPTION
                    'Unsupported physical exchange tender';
            END IF;

            IF jsonb_typeof(tender->'amount')
               IS DISTINCT FROM 'number'
            THEN
                RAISE EXCEPTION
                    'Invalid exchange tender amount';
            END IF;

            tender_amount :=
                (tender->>'amount')::numeric;

            IF tender_amount <= 0
               OR tender_amount > 9999999999.99
               OR tender_amount <>
                  round(tender_amount,2)
            THEN
                RAISE EXCEPTION
                    'Invalid exchange tender precision';
            END IF;

            IF tender_type <> 'CASH'
               AND length(
                   btrim(
                       coalesce(
                           tender->>'reference',''
                       )
                   )
               ) = 0
            THEN
                RAISE EXCEPTION
                    'Noncash tender reference required';
            END IF;

            CASE tender_type
                WHEN 'CASH' THEN
                    cash_total :=
                        cash_total + tender_amount;
                WHEN 'CARD' THEN
                    card_total :=
                        card_total + tender_amount;
                WHEN 'OTHER' THEN
                    other_total :=
                        other_total + tender_amount;
            END CASE;

        END LOOP;

        IF cash_total + card_total + other_total
           <> c.amount
           OR NEW."cashAmount" <> cash_total
           OR NEW."cardAmount" <> card_total
           OR NEW."otherAmount" <> other_total
        THEN
            RAISE EXCEPTION
                'Exchange tender allocation mismatch';
        END IF;

    END IF;

    IF EXISTS (
        SELECT 1
        FROM "PosFinancialCorrectionRelease"
        WHERE "correctionId" = c.id
    ) THEN
        RAISE EXCEPTION
            'Released correction cannot receive new evidence';
    END IF;

    RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_economic_event_guard
BEFORE INSERT OR UPDATE OR DELETE
ON "PosFinancialCorrectionEconomicEvent"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_economic_event();


-- R10_3D24_48D3G4D3_DATABASE_PERIOD_GUARD

CREATE FUNCTION r103d24_guard_economic_posting()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    ev "PosFinancialCorrectionEconomicEvent"%ROWTYPE;
    historical_lock_count INTEGER;
    expected_treatment TEXT;
    required_prefix TEXT;
    tender_count INTEGER;
BEGIN

    LOCK TABLE "FinancePeriodLock" IN SHARE MODE;

    SELECT * INTO STRICT ev
    FROM "PosFinancialCorrectionEconomicEvent"
    WHERE "correctionId" = NEW."correctionId";

    IF ev."executionId" <> NEW."executionId"
       OR ev."locationId" <> NEW."locationId"
       OR ev.amount <> NEW.amount
       OR ev."recordedAt" > NEW."postedAt"
       OR ev."recordedById" = NEW."postedById"
    THEN
        RAISE EXCEPTION
            'Economic event posting identity mismatch';
    END IF;

    tender_count :=
        CASE WHEN ev."cashAmount" > 0 THEN 1 ELSE 0 END
        + CASE WHEN ev."cardAmount" > 0 THEN 1 ELSE 0 END
        + CASE WHEN ev."otherAmount" > 0 THEN 1 ELSE 0 END;

    IF tender_count <> 1 THEN
        RAISE EXCEPTION
            'Dedicated mixed-tender accounting required';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "FinancePeriodLock" p
        WHERE p."locationId" = NEW."locationId"
          AND p."periodStart" <= NEW."postedAt"
          AND p."periodEnd" > NEW."postedAt"
    ) THEN
        RAISE EXCEPTION
            'Correction posting period is locked';
    END IF;

    SELECT count(*) INTO historical_lock_count
    FROM "FinancePeriodLock" p
    WHERE p."locationId" = NEW."locationId"
      AND p."periodStart" <= ev."economicEventAt"
      AND p."periodEnd" > ev."economicEventAt";

    IF historical_lock_count > 1 THEN
        RAISE EXCEPTION
            'Overlapping historical period locks';
    END IF;

    IF historical_lock_count = 1 THEN
        expected_treatment := 'LOCKED_PERIOD_ADJUSTMENT';
    ELSE
        expected_treatment := 'CURRENT_PERIOD_ADJUSTMENT';
    END IF;

    required_prefix :=
        '[' || expected_treatment || '] ';

    IF left(
        NEW."postingNote",
        length(required_prefix)
    ) <> required_prefix
       OR length(
           btrim(
               substring(
                   NEW."postingNote"
                   FROM length(required_prefix) + 1
               )
           )
       ) < 20
    THEN
        RAISE EXCEPTION
            'Explicit accounting period treatment required';
    END IF;

    RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_economic_posting_guard
BEFORE INSERT
ON "PosFinancialCorrectionPosting"
FOR EACH ROW
EXECUTE FUNCTION r103d24_guard_economic_posting();

COMMIT;
