CREATE TABLE "AidatSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "monthlyAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "annualDiscountPercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AidatSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AidatSettings" (
  "id",
  "monthlyAmount",
  "currency",
  "annualDiscountPercent",
  "createdAt",
  "updatedAt"
)
VALUES ('default', 0, 'GBP', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "AidatRatePeriod" (
  "id" TEXT NOT NULL,
  "monthlyAmount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL,
  "annualDiscountPercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AidatRatePeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UnitAidatPayment" (
  "id" TEXT NOT NULL,
  "unitSelectionId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "periodKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "originalAmount" DOUBLE PRECISION,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNPAID',
  "billingType" TEXT NOT NULL DEFAULT 'MONTHLY',
  "discountPercent" DOUBLE PRECISION,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  "paidById" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UnitAidatPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AidatRatePeriod_effectiveFrom_effectiveTo_idx"
  ON "AidatRatePeriod"("effectiveFrom", "effectiveTo");

CREATE UNIQUE INDEX "UnitAidatPayment_unitSelectionId_periodKey_key"
  ON "UnitAidatPayment"("unitSelectionId", "periodKey");

CREATE INDEX "UnitAidatPayment_periodKey_status_idx"
  ON "UnitAidatPayment"("periodKey", "status");

CREATE INDEX "UnitAidatPayment_dueDate_status_idx"
  ON "UnitAidatPayment"("dueDate", "status");

CREATE INDEX "UnitAidatPayment_unitSelectionId_year_month_idx"
  ON "UnitAidatPayment"("unitSelectionId", "year", "month");

ALTER TABLE "UnitAidatPayment"
  ADD CONSTRAINT "UnitAidatPayment_unitSelectionId_fkey"
  FOREIGN KEY ("unitSelectionId") REFERENCES "CustomerUnitSelection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
