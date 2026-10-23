-- Existing leads keep their follow-up order. New inbound leads opt into priority.
ALTER TABLE "Lead" ADD COLUMN "newPriorityAt" TIMESTAMP(3);
CREATE INDEX "Lead_newPriorityAt_idx" ON "Lead"("newPriorityAt");
