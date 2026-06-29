ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ACCOUNTING';

CREATE TYPE "FinanceEntryKind" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "FinancePaymentType" AS ENUM (
  'SALE_INSTALLMENT',
  'CREDIT_INSTALLMENT',
  'CHECK_PAYMENT',
  'REALTOR_COMMISSION',
  'SUBCONTRACTOR',
  'INVOICE',
  'OTHER',
  'TAX',
  'SALARY'
);
CREATE TYPE "FinancePaymentStatus" AS ENUM ('PLANNED', 'PAID', 'OVERDUE', 'CANCELED');
CREATE TYPE "FinanceCurrency" AS ENUM ('GBP', 'USD', 'EUR', 'TRY');
CREATE TYPE "FinanceSettlementMethod" AS ENUM ('CASH', 'CHECK', 'BARTER', 'BANK_TRANSFER', 'OTHER');

CREATE TABLE "FinanceEntry" (
  "id" TEXT NOT NULL,
  "kind" "FinanceEntryKind" NOT NULL,
  "paymentType" "FinancePaymentType" NOT NULL,
  "status" "FinancePaymentStatus" NOT NULL DEFAULT 'PLANNED',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "vendorName" TEXT,
  "contractReference" TEXT,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" "FinanceCurrency" NOT NULL DEFAULT 'GBP',
  "exchangeRateToBase" DECIMAL(14,6),
  "baseCurrency" "FinanceCurrency" NOT NULL DEFAULT 'GBP',
  "originalDueDate" TIMESTAMP(3) NOT NULL,
  "plannedDueDate" TIMESTAMP(3) NOT NULL,
  "selectedDeferralDays" INTEGER,
  "paidAt" TIMESTAMP(3),
  "customerId" TEXT,
  "unitSelectionId" TEXT,
  "project" "ProjectType",
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinanceEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceEntryDueOption" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "daysFromOriginal" INTEGER NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "isSelected" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceEntryDueOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceEntrySplit" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "method" "FinanceSettlementMethod" NOT NULL,
  "ratio" DECIMAL(6,2) NOT NULL,
  "amount" DECIMAL(14,2),
  "note" TEXT,
  "unitSelectionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinanceEntrySplit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceEntryLog" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "field" TEXT,
  "oldValue" TEXT,
  "newValue" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceEntryLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceExchangeRate" (
  "id" TEXT NOT NULL,
  "currency" "FinanceCurrency" NOT NULL,
  "baseCurrency" "FinanceCurrency" NOT NULL DEFAULT 'GBP',
  "rateToBase" DECIMAL(14,6) NOT NULL,
  "effectiveDate" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinanceExchangeRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinanceEntryDueOption_entryId_daysFromOriginal_key"
  ON "FinanceEntryDueOption"("entryId", "daysFromOriginal");

CREATE INDEX "FinanceEntry_kind_plannedDueDate_idx" ON "FinanceEntry"("kind", "plannedDueDate");
CREATE INDEX "FinanceEntry_status_plannedDueDate_idx" ON "FinanceEntry"("status", "plannedDueDate");
CREATE INDEX "FinanceEntry_paymentType_idx" ON "FinanceEntry"("paymentType");
CREATE INDEX "FinanceEntry_currency_idx" ON "FinanceEntry"("currency");
CREATE INDEX "FinanceEntry_customerId_idx" ON "FinanceEntry"("customerId");
CREATE INDEX "FinanceEntry_unitSelectionId_idx" ON "FinanceEntry"("unitSelectionId");
CREATE INDEX "FinanceEntry_project_idx" ON "FinanceEntry"("project");
CREATE INDEX "FinanceEntryDueOption_entryId_idx" ON "FinanceEntryDueOption"("entryId");
CREATE INDEX "FinanceEntryDueOption_dueDate_idx" ON "FinanceEntryDueOption"("dueDate");
CREATE INDEX "FinanceEntrySplit_entryId_idx" ON "FinanceEntrySplit"("entryId");
CREATE INDEX "FinanceEntrySplit_method_idx" ON "FinanceEntrySplit"("method");
CREATE INDEX "FinanceEntrySplit_unitSelectionId_idx" ON "FinanceEntrySplit"("unitSelectionId");
CREATE INDEX "FinanceEntryLog_entryId_createdAt_idx" ON "FinanceEntryLog"("entryId", "createdAt");
CREATE INDEX "FinanceEntryLog_createdById_idx" ON "FinanceEntryLog"("createdById");
CREATE INDEX "FinanceEntryLog_action_idx" ON "FinanceEntryLog"("action");
CREATE INDEX "FinanceExchangeRate_currency_baseCurrency_effectiveDate_idx"
  ON "FinanceExchangeRate"("currency", "baseCurrency", "effectiveDate");

ALTER TABLE "FinanceEntry"
  ADD CONSTRAINT "FinanceEntry_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceEntry"
  ADD CONSTRAINT "FinanceEntry_unitSelectionId_fkey"
  FOREIGN KEY ("unitSelectionId") REFERENCES "CustomerUnitSelection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceEntry"
  ADD CONSTRAINT "FinanceEntry_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceEntry"
  ADD CONSTRAINT "FinanceEntry_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceEntryDueOption"
  ADD CONSTRAINT "FinanceEntryDueOption_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "FinanceEntry"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinanceEntrySplit"
  ADD CONSTRAINT "FinanceEntrySplit_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "FinanceEntry"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinanceEntrySplit"
  ADD CONSTRAINT "FinanceEntrySplit_unitSelectionId_fkey"
  FOREIGN KEY ("unitSelectionId") REFERENCES "CustomerUnitSelection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceEntryLog"
  ADD CONSTRAINT "FinanceEntryLog_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "FinanceEntry"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinanceEntryLog"
  ADD CONSTRAINT "FinanceEntryLog_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceExchangeRate"
  ADD CONSTRAINT "FinanceExchangeRate_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
