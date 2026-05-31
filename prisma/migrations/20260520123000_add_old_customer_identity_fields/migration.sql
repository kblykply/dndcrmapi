ALTER TABLE "Customer" ADD COLUMN "identityNumber" TEXT;
ALTER TABLE "Customer" ADD COLUMN "oldCustomerCode" TEXT;
ALTER TABLE "Customer" ADD COLUMN "oldCariCodes" TEXT;

CREATE UNIQUE INDEX "Customer_oldCustomerCode_key" ON "Customer"("oldCustomerCode");
CREATE INDEX "Customer_identityNumber_idx" ON "Customer"("identityNumber");
