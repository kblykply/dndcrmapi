ALTER TABLE "BulkEmailCampaign" ADD COLUMN "pausedAt" TIMESTAMP(3), ADD COLUMN "pauseReason" TEXT;
ALTER TABLE "BulkEmailRecipient" ADD COLUMN "subject" TEXT, ADD COLUMN "deliveryLanguage" TEXT;
-- Already queued campaigns stay paused during rollout. New campaigns use the normal explicit send action.
UPDATE "BulkEmailCampaign" SET "pausedAt" = CURRENT_TIMESTAMP, "pauseReason" = 'Paused during subject and tracking update' WHERE "status" = 'SENDING';
