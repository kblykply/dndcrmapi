-- CreateEnum
CREATE TYPE "CrmTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CrmTaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "CrmTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "CrmTaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "CrmTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "agencyId" TEXT,
    "customerId" TEXT,
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmTask_status_idx" ON "CrmTask"("status");

-- CreateIndex
CREATE INDEX "CrmTask_assignedToId_idx" ON "CrmTask"("assignedToId");

-- CreateIndex
CREATE INDEX "CrmTask_agencyId_idx" ON "CrmTask"("agencyId");

-- CreateIndex
CREATE INDEX "CrmTask_customerId_idx" ON "CrmTask"("customerId");

-- CreateIndex
CREATE INDEX "CrmTask_dueAt_idx" ON "CrmTask"("dueAt");

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
