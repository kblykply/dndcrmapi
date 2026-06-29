DROP TABLE IF EXISTS "UnitAidatPayment";
DROP TABLE IF EXISTS "AidatRatePeriod";
DROP TABLE IF EXISTS "AidatSettings";

ALTER TABLE "CustomerUnitSelection"
  DROP COLUMN IF EXISTS "installments";
