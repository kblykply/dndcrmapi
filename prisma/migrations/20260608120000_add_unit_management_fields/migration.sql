CREATE TYPE "UnitDeliveryStatus" AS ENUM ('NOT_READY', 'READY_TO_DELIVER', 'DELIVERED');
CREATE TYPE "UnitCompanyStatus" AS ENUM ('UNKNOWN', 'DND', 'OTHER');

ALTER TABLE "CustomerUnitSelection"
  ADD COLUMN "deliveryStatus" "UnitDeliveryStatus" NOT NULL DEFAULT 'NOT_READY',
  ADD COLUMN "companyStatus" "UnitCompanyStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "generalInfo" TEXT,
  ADD COLUMN "unitInfo" TEXT,
  ADD COLUMN "customerRequest" TEXT,
  ADD COLUMN "customerComplaint" TEXT,
  ADD COLUMN "unitComplaint" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "CustomerUnitSelection_project_idx" ON "CustomerUnitSelection"("project");
CREATE INDEX "CustomerUnitSelection_deliveryStatus_idx" ON "CustomerUnitSelection"("deliveryStatus");
CREATE INDEX "CustomerUnitSelection_companyStatus_idx" ON "CustomerUnitSelection"("companyStatus");
