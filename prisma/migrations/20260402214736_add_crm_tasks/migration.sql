-- AlterTable
ALTER TABLE "CrmTask" ADD COLUMN     "leadId" TEXT;

-- CreateIndex
CREATE INDEX "CrmTask_leadId_idx" ON "CrmTask"("leadId");

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
