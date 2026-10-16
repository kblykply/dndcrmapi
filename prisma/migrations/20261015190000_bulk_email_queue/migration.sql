ALTER TABLE "BulkEmailCampaign" ADD COLUMN "requestKey" TEXT;
CREATE UNIQUE INDEX "BulkEmailCampaign_requestKey_key" ON "BulkEmailCampaign"("requestKey");
ALTER TYPE "BulkEmailRecipientStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "BulkEmailRecipientStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE "BulkEmailRecipientStatus" ADD VALUE IF NOT EXISTS 'UNCERTAIN';
ALTER TYPE "BulkEmailRecipientStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';
CREATE TABLE "BulkEmailJob" (
 "id" TEXT PRIMARY KEY, "recipientId" TEXT NOT NULL UNIQUE REFERENCES "BulkEmailRecipient"("id") ON DELETE CASCADE,
 "campaignId" TEXT NOT NULL REFERENCES "BulkEmailCampaign"("id") ON DELETE CASCADE,
 "status" TEXT NOT NULL DEFAULT 'QUEUED', "payload" JSONB NOT NULL,
 "attempts" INTEGER NOT NULL DEFAULT 0, "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "startedAt" TIMESTAMP(3), "messageId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BulkEmailJob_status_availableAt_idx" ON "BulkEmailJob"("status","availableAt");
CREATE INDEX "BulkEmailJob_campaignId_idx" ON "BulkEmailJob"("campaignId");
CREATE TABLE "BulkEmailDispatchState" (
 "id" TEXT PRIMARY KEY, "nextSendAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "count" INTEGER NOT NULL DEFAULT 0, "dayStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "dayCount" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "BulkEmailDispatchState" ("id") VALUES ('global');
CREATE TABLE "BulkEmailSuppression" ("email" TEXT PRIMARY KEY,"reason" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE "BulkEmailJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BulkEmailDispatchState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BulkEmailSuppression" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "BulkEmailJob", "BulkEmailDispatchState", "BulkEmailSuppression" FROM anon, authenticated;
