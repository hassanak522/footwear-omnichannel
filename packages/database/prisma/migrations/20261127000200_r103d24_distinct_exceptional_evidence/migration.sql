BEGIN;

-- R10_3D24C_DISTINCT_EXCEPTIONAL_EVIDENCE

CREATE OR REPLACE FUNCTION
r103d24_distinct_exceptional_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

 IF NEW."kind" <> 'EXCHANGE_REVERSAL'
    OR NEW."proposedOutcome" <> 'REVERSED'
 THEN
  RETURN NEW;
 END IF;

 IF TG_OP = 'UPDATE' THEN
  IF NEW."status" <> 'APPROVED' THEN
   RETURN NEW;
  END IF;
 END IF;

 IF EXISTS (
  SELECT 1
  FROM "PosPaymentReconciliation" previous
  WHERE previous."exchangeAttemptId" =
        NEW."exchangeAttemptId"
    AND previous."kind" = 'EXCHANGE_REVERSAL'
    AND previous."proposedOutcome" = 'NOT_REVERSED'
    AND previous."status" = 'APPROVED'
    AND lower(btrim(previous."evidenceReference")) =
        lower(btrim(NEW."evidenceReference"))
 ) THEN

  RAISE EXCEPTION
   'Exceptional reversal requires distinct positive evidence'
   USING ERRCODE = '23514';

 END IF;

 RETURN NEW;

END;
$$;

CREATE TRIGGER r103d24_distinct_exceptional_evidence_guard
BEFORE INSERT OR UPDATE
ON "PosPaymentReconciliation"
FOR EACH ROW
EXECUTE FUNCTION r103d24_distinct_exceptional_evidence();

COMMIT;