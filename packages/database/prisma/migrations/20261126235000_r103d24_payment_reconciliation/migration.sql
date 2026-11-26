BEGIN;

CREATE TABLE "PosPaymentReconciliation" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "refundAttemptId" UUID,
    "exchangeAttemptId" UUID,

    "locationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,

    "paymentOperatorId" UUID NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    "originalStatus" TEXT NOT NULL,
    "originalPaymentState" TEXT NOT NULL,
    "originalReversalStatus" TEXT,

    "proposedOutcome" VARCHAR(32) NOT NULL,
    "evidenceReference" VARCHAR(200) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "executionAbandoned" BOOLEAN NOT NULL DEFAULT false,

    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "submittedById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" VARCHAR(1000),

    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosPaymentReconciliation_pkey"
      PRIMARY KEY ("id"),

    CONSTRAINT "r103d24_reconciliation_amount"
      CHECK ("amount" > 0),

    CONSTRAINT "r103d24_reconciliation_kind_outcome"
      CHECK (
        (
          "kind" = 'REFUND_PAYOUT'
          AND "refundAttemptId" IS NOT NULL
          AND "exchangeAttemptId" IS NULL
          AND "proposedOutcome" IN ('PAID','NOT_PAID')
          AND "originalReversalStatus" IS NULL
        )
        OR
        (
          "kind" = 'EXCHANGE_COLLECTION'
          AND "refundAttemptId" IS NULL
          AND "exchangeAttemptId" IS NOT NULL
          AND "proposedOutcome" IN ('COLLECTED','NOT_COLLECTED')
          AND "originalReversalStatus" = 'NONE'
          AND "originalReversalStatus" IS NOT NULL
        )
        OR
        (
          "kind" = 'EXCHANGE_REVERSAL'
          AND "refundAttemptId" IS NULL
          AND "exchangeAttemptId" IS NOT NULL
          AND "proposedOutcome" IN ('REVERSED','NOT_REVERSED')
          AND "originalReversalStatus" = 'AUTHORIZED'
          AND "originalReversalStatus" IS NOT NULL
        )
      ),

    CONSTRAINT "r103d24_reconciliation_evidence"
      CHECK (
        length(btrim("evidenceReference")) >= 5
        AND length(btrim("reason")) >= 10
        AND length(btrim("payloadHash")) > 0
      ),

    CONSTRAINT "r103d24_reconciliation_abandonment"
      CHECK (
        "proposedOutcome" NOT IN (
          'NOT_PAID','NOT_COLLECTED','NOT_REVERSED'
        )
        OR (
          "executionAbandoned" = true
          AND "submittedById" = "paymentOperatorId"
        )
      ),

    CONSTRAINT "r103d24_reconciliation_review"
      CHECK (
        (
          "status" = 'PENDING'
          AND "reviewedById" IS NULL
          AND "reviewedAt" IS NULL
          AND "reviewNote" IS NULL
        )
        OR
        (
          "status" IN ('APPROVED','REJECTED')
          AND "reviewedById" IS NOT NULL
          AND "reviewedAt" IS NOT NULL
          AND "reviewNote" IS NOT NULL
          AND "reviewedById" <> "submittedById"
          AND "reviewedById" <> "paymentOperatorId"
          AND "reviewedAt" >= "submittedAt"
          AND length(btrim("reviewNote")) >= 10
        )
      )
);

ALTER TABLE "PosPaymentReconciliation"
 ADD CONSTRAINT "r103d24_reconciliation_refund_fk"
 FOREIGN KEY ("refundAttemptId")
 REFERENCES "PosRefundAttempt"("id")
 ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PosPaymentReconciliation"
 ADD CONSTRAINT "r103d24_reconciliation_exchange_fk"
 FOREIGN KEY ("exchangeAttemptId")
 REFERENCES "PosExchangeAttempt"("id")
 ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PosPaymentReconciliation"
 ADD CONSTRAINT "r103d24_reconciliation_operator_fk"
 FOREIGN KEY ("paymentOperatorId")
 REFERENCES "User"("id")
 ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PosPaymentReconciliation"
 ADD CONSTRAINT "r103d24_reconciliation_submitter_fk"
 FOREIGN KEY ("submittedById")
 REFERENCES "User"("id")
 ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PosPaymentReconciliation"
 ADD CONSTRAINT "r103d24_reconciliation_reviewer_fk"
 FOREIGN KEY ("reviewedById")
 REFERENCES "User"("id")
 ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "PosPaymentReconciliation_refundAttemptId_status_idx"
 ON "PosPaymentReconciliation"("refundAttemptId","status");

CREATE INDEX "PosPaymentReconciliation_exchangeAttemptId_status_idx"
 ON "PosPaymentReconciliation"("exchangeAttemptId","status");

CREATE INDEX "PosPaymentReconciliation_locationId_status_idx"
 ON "PosPaymentReconciliation"("locationId","status");

CREATE INDEX "PosPaymentReconciliation_shiftId_status_idx"
 ON "PosPaymentReconciliation"("shiftId","status");

CREATE INDEX "PosPaymentReconciliation_submittedAt_idx"
 ON "PosPaymentReconciliation"("submittedAt");

CREATE UNIQUE INDEX "r103d24_one_pending_refund_investigation"
 ON "PosPaymentReconciliation"("refundAttemptId")
 WHERE "status" = 'PENDING'
 AND "refundAttemptId" IS NOT NULL;

CREATE UNIQUE INDEX "r103d24_one_pending_exchange_investigation"
 ON "PosPaymentReconciliation"("exchangeAttemptId")
 WHERE "status" = 'PENDING'
 AND "exchangeAttemptId" IS NOT NULL;

CREATE FUNCTION r103d24_guard_payment_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF TG_OP = 'DELETE' THEN
   RAISE EXCEPTION
    'Payment reconciliation history cannot be deleted';
 END IF;

 IF TG_OP = 'INSERT' THEN

   IF NEW."status" <> 'PENDING' THEN
     RAISE EXCEPTION
      'New investigations must begin pending';
   END IF;

   RETURN NEW;

 END IF;

 IF OLD."status" <> 'PENDING' THEN
   RAISE EXCEPTION
    'Finalized investigations are immutable';
 END IF;

 IF NEW."status" NOT IN ('APPROVED','REJECTED') THEN
   RAISE EXCEPTION
    'Investigation update requires a final review decision';
 END IF;

 IF ROW(
   OLD."id",
   OLD."kind",
   OLD."refundAttemptId",
   OLD."exchangeAttemptId",
   OLD."locationId",
   OLD."deviceId",
   OLD."shiftId",
   OLD."paymentOperatorId",
   OLD."payloadHash",
   OLD."amount",
   OLD."originalStatus",
   OLD."originalPaymentState",
   OLD."originalReversalStatus",
   OLD."proposedOutcome",
   OLD."evidenceReference",
   OLD."reason",
   OLD."executionAbandoned",
   OLD."submittedById",
   OLD."submittedAt"
 ) IS DISTINCT FROM ROW(
   NEW."id",
   NEW."kind",
   NEW."refundAttemptId",
   NEW."exchangeAttemptId",
   NEW."locationId",
   NEW."deviceId",
   NEW."shiftId",
   NEW."paymentOperatorId",
   NEW."payloadHash",
   NEW."amount",
   NEW."originalStatus",
   NEW."originalPaymentState",
   NEW."originalReversalStatus",
   NEW."proposedOutcome",
   NEW."evidenceReference",
   NEW."reason",
   NEW."executionAbandoned",
   NEW."submittedById",
   NEW."submittedAt"
 ) THEN
   RAISE EXCEPTION
    'Submitted investigation evidence is immutable';
 END IF;

 RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_payment_reconciliation_guard
 BEFORE INSERT OR UPDATE OR DELETE
 ON "PosPaymentReconciliation"
 FOR EACH ROW
 EXECUTE FUNCTION r103d24_guard_payment_reconciliation();

COMMIT;