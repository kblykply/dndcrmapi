CREATE TYPE "UnitCompanyStatus" AS ENUM ('UNKNOWN', 'DND', 'OTHER');

ALTER TABLE "CustomerUnitSelection"
  ADD COLUMN "companyStatus" "UnitCompanyStatus" NOT NULL DEFAULT 'UNKNOWN';

UPDATE "CustomerUnitSelection"
SET "companyStatus" = CASE
  WHEN "deliveryStatus"::text = 'DND' THEN 'DND'::"UnitCompanyStatus"
  WHEN "deliveryStatus"::text = 'OTHER' THEN 'OTHER'::"UnitCompanyStatus"
  ELSE 'UNKNOWN'::"UnitCompanyStatus"
END;

ALTER TABLE "CustomerUnitSelection"
  ALTER COLUMN "deliveryStatus" DROP DEFAULT;

CREATE TYPE "UnitDeliveryStatus_new" AS ENUM ('NOT_READY', 'READY_TO_DELIVER', 'DELIVERED');

ALTER TABLE "CustomerUnitSelection"
  ALTER COLUMN "deliveryStatus" TYPE "UnitDeliveryStatus_new"
  USING 'NOT_READY'::"UnitDeliveryStatus_new";

DROP TYPE "UnitDeliveryStatus";

ALTER TYPE "UnitDeliveryStatus_new" RENAME TO "UnitDeliveryStatus";

ALTER TABLE "CustomerUnitSelection"
  ALTER COLUMN "deliveryStatus" SET DEFAULT 'NOT_READY';

CREATE INDEX "CustomerUnitSelection_companyStatus_idx" ON "CustomerUnitSelection"("companyStatus");
