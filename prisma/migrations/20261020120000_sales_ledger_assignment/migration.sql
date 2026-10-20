CREATE TABLE "SalesLedgerAssignment" (
  "key" VARCHAR(64) PRIMARY KEY,
  "customerCode" TEXT NOT NULL,
  "unitCode" TEXT NOT NULL,
  "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "changedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesLedgerAssignment_customerCode_unitCode_key" UNIQUE ("customerCode", "unitCode"),
  CONSTRAINT "SalesLedgerAssignment_identity_check" CHECK (length(trim("customerCode")) > 0 AND length(trim("unitCode")) > 0),
  CONSTRAINT "SalesLedgerAssignment_version_check" CHECK ("version" > 0)
);
CREATE INDEX "SalesLedgerAssignment_userId_idx" ON "SalesLedgerAssignment"("userId");
ALTER TABLE "SalesLedgerAssignment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "SalesLedgerAssignment" FROM anon, authenticated;
