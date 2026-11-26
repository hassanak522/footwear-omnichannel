-- R10.3D24: Active shift uniqueness
-- Historical records are preserved.
-- Existing duplicates must be reconciled before migration.

BEGIN;

LOCK TABLE "PosShift" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN

 IF EXISTS (
  SELECT "cashierId"
  FROM "PosShift"
  WHERE "status" = 'OPEN'
  GROUP BY "cashierId"
  HAVING COUNT(*) > 1
 ) THEN
  RAISE EXCEPTION
   'D24 migration blocked: duplicate active cashier shifts';
 END IF;

 IF EXISTS (
  SELECT "deviceId"
  FROM "PosShift"
  WHERE "status" = 'OPEN'
  GROUP BY "deviceId"
  HAVING COUNT(*) > 1
 ) THEN
  RAISE EXCEPTION
   'D24 migration blocked: duplicate active device shifts';
 END IF;

END $$;

CREATE UNIQUE INDEX "r103d24_one_open_shift_per_cashier"
ON "PosShift" ("cashierId")
WHERE "status" = 'OPEN';

CREATE UNIQUE INDEX "r103d24_one_open_shift_per_device"
ON "PosShift" ("deviceId")
WHERE "status" = 'OPEN';

COMMIT;