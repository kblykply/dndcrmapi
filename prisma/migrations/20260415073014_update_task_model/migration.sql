/*
  Warnings:

  - The `status` column on the `Task` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "agencyId" TEXT,
ADD COLUMN     "customerId" TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" "CrmTaskStatus" NOT NULL DEFAULT 'TODO',
ALTER COLUMN "dueAt" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Task_assignedToId_status_dueAt_idx" ON "Task"("assignedToId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_leadId_status_dueAt_idx" ON "Task"("leadId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_agencyId_status_dueAt_idx" ON "Task"("agencyId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_customerId_status_dueAt_idx" ON "Task"("customerId", "status", "dueAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
