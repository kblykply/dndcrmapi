CREATE TYPE "BulkEmailCampaignStatus" AS ENUM ('SENDING', 'COMPLETED', 'PARTIAL', 'FAILED');

CREATE TYPE "BulkEmailRecipientStatus" AS ENUM ('SENT', 'FAILED', 'MISSING_EMAIL');

CREATE TABLE "BulkEmailCampaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "project" "ProjectType" NOT NULL,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "attachmentFileName" TEXT,
  "status" "BulkEmailCampaignStatus" NOT NULL DEFAULT 'SENDING',
  "totalUnits" INTEGER NOT NULL DEFAULT 0,
  "uniqueCustomers" INTEGER NOT NULL DEFAULT 0,
  "attemptedCount" INTEGER NOT NULL DEFAULT 0,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "missingEmailCount" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BulkEmailCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkEmailRecipient" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "customerId" TEXT,
  "customerName" TEXT NOT NULL,
  "companyName" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "ownerName" TEXT,
  "ownerEmail" TEXT,
  "ownerRole" TEXT,
  "unitNumbers" TEXT NOT NULL,
  "unitSnapshot" JSONB,
  "status" "BulkEmailRecipientStatus" NOT NULL,
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BulkEmailRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BulkEmailCampaign_project_sentAt_idx" ON "BulkEmailCampaign"("project", "sentAt");
CREATE INDEX "BulkEmailCampaign_status_idx" ON "BulkEmailCampaign"("status");
CREATE INDEX "BulkEmailCampaign_createdById_idx" ON "BulkEmailCampaign"("createdById");
CREATE INDEX "BulkEmailCampaign_sentAt_idx" ON "BulkEmailCampaign"("sentAt");
CREATE INDEX "BulkEmailRecipient_campaignId_idx" ON "BulkEmailRecipient"("campaignId");
CREATE INDEX "BulkEmailRecipient_customerId_idx" ON "BulkEmailRecipient"("customerId");
CREATE INDEX "BulkEmailRecipient_status_idx" ON "BulkEmailRecipient"("status");
CREATE INDEX "BulkEmailRecipient_email_idx" ON "BulkEmailRecipient"("email");

ALTER TABLE "BulkEmailCampaign"
  ADD CONSTRAINT "BulkEmailCampaign_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BulkEmailRecipient"
  ADD CONSTRAINT "BulkEmailRecipient_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "BulkEmailCampaign"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BulkEmailRecipient"
  ADD CONSTRAINT "BulkEmailRecipient_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
