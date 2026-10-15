CREATE TABLE "SalesLedgerRepresentative" (
  "code" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SalesLedgerRepresentative_userId_idx" ON "SalesLedgerRepresentative"("userId");
ALTER TABLE "SalesLedgerRepresentative" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "SalesLedgerRepresentative" FROM anon, authenticated;
