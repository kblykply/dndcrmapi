ALTER TABLE "CustomerUnitSelection"
  ADD COLUMN "isCanceled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canceledAt" TIMESTAMP(3),
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "canceledById" TEXT,
  ADD COLUMN "kdvStatus" TEXT NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN "trafoStatus" TEXT NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN "installments" JSONB,
  ADD COLUMN "electricityProvider" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "waterAccessStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "rentalPackage" TEXT NOT NULL DEFAULT 'NOT_INTERESTED',
  ADD COLUMN "customFurniture" TEXT,
  ADD COLUMN "rentalStatus" TEXT NOT NULL DEFAULT 'NOT_INTERESTED';

CREATE INDEX "CustomerUnitSelection_isCanceled_idx" ON "CustomerUnitSelection"("isCanceled");
CREATE INDEX "CustomerUnitSelection_rentalStatus_idx" ON "CustomerUnitSelection"("rentalStatus");

ALTER TABLE "CustomerUnitSelection"
  ADD CONSTRAINT "CustomerUnitSelection_canceledById_fkey"
  FOREIGN KEY ("canceledById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
