ALTER TABLE "CustomerUnitSelection"
  ADD COLUMN "previousCustomerId" TEXT;

CREATE INDEX "CustomerUnitSelection_previousCustomerId_idx"
  ON "CustomerUnitSelection"("previousCustomerId");

ALTER TABLE "CustomerUnitSelection"
  ADD CONSTRAINT "CustomerUnitSelection_previousCustomerId_fkey"
  FOREIGN KEY ("previousCustomerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Customer" (
  "id",
  "fullName",
  "companyName",
  "source",
  "type",
  "notesSummary",
  "oldCustomerCode",
  "createdAt",
  "updatedAt"
)
VALUES (
  'dnd-company-owner',
  'DND Cyprus',
  'DND Cyprus',
  'SYSTEM',
  'EXISTING',
  'System customer used as the owner of canceled units.',
  'DND_COMPANY_OWNER',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("oldCustomerCode") DO UPDATE SET
  "fullName" = EXCLUDED."fullName",
  "companyName" = EXCLUDED."companyName",
  "type" = EXCLUDED."type",
  "notesSummary" = EXCLUDED."notesSummary",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "CustomerUnitSelection" AS unit
SET
  "previousCustomerId" = unit."customerId",
  "customerId" = dnd."id"
FROM (
  SELECT "id"
  FROM "Customer"
  WHERE "oldCustomerCode" = 'DND_COMPANY_OWNER'
  LIMIT 1
) AS dnd
WHERE
  unit."isCanceled" = TRUE
  AND unit."customerId" <> dnd."id"
  AND unit."previousCustomerId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "CustomerUnitSelection" AS existing
    WHERE
      existing."id" <> unit."id"
      AND existing."customerId" = dnd."id"
      AND existing."project" = unit."project"
      AND existing."unitNumber" = unit."unitNumber"
  );
