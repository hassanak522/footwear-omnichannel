ALTER TABLE "PosClearanceAttempt"
DROP CONSTRAINT "PosClearanceAttempt_status_check";

ALTER TABLE "PosClearanceAttempt"
ADD CONSTRAINT "PosClearanceAttempt_status_check"
CHECK (
  "status" IN (
    'REGISTERED',
    'ACCEPTED',
    'REVIEW_REQUIRED',
    'RESOLVED_NO_SALE'
  )
);
