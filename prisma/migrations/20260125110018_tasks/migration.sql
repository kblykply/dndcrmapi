-- CreateIndex
CREATE INDEX "Lead_nextFollowUpAt_status_idx" ON "Lead"("nextFollowUpAt", "status");
