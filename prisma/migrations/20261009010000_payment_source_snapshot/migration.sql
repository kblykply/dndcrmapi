CREATE TABLE IF NOT EXISTS "PaymentSourceBatch" (
  id TEXT PRIMARY KEY,
  "importedAt" TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  "recordCount" INTEGER NOT NULL,
  "caseCount" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentSourceBatch_one_active" ON "PaymentSourceBatch" (active) WHERE active;
CREATE TABLE IF NOT EXISTS "PaymentSourceDataset" (
  "batchId" TEXT NOT NULL REFERENCES "PaymentSourceBatch"(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'array'),
  PRIMARY KEY ("batchId", key)
);
ALTER TABLE "PaymentSourceBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentSourceDataset" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PaymentSourceBatch", "PaymentSourceDataset" FROM anon, authenticated;
