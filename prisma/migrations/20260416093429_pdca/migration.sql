-- CreateEnum
CREATE TYPE "PdcaPhase" AS ENUM ('PLAN', 'DO', 'CHECK', 'ACT');

-- CreateEnum
CREATE TYPE "PdcaStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PdcaImpactLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PdcaIssueCategory" AS ENUM ('SALES', 'MARKETING', 'OPERATIONS', 'CUSTOMER_SERVICE', 'FINANCE', 'HR', 'PROJECT', 'OTHER');

-- CreateTable
CREATE TABLE "PdcaCase" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "problemSummary" TEXT NOT NULL,
    "department" TEXT,
    "issueCategory" TEXT,
    "problemType" TEXT,
    "impactLevel" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "phase" "PdcaPhase" NOT NULL DEFAULT 'PLAN',
    "status" "PdcaStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT,
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "rootCause" TEXT,
    "targetResult" TEXT,
    "actionPlan" TEXT,
    "doNotes" TEXT,
    "checkResult" TEXT,
    "correctiveAction" TEXT,
    "preventiveAction" TEXT,
    "finalDecision" TEXT,
    "dueAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdcaCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PdcaLog" (
    "id" TEXT NOT NULL,
    "pdcaCaseId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "phase" "PdcaPhase",
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PdcaLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PdcaCase_phase_idx" ON "PdcaCase"("phase");

-- CreateIndex
CREATE INDEX "PdcaCase_status_idx" ON "PdcaCase"("status");

-- CreateIndex
CREATE INDEX "PdcaCase_priority_idx" ON "PdcaCase"("priority");

-- CreateIndex
CREATE INDEX "PdcaCase_assignedToId_idx" ON "PdcaCase"("assignedToId");

-- CreateIndex
CREATE INDEX "PdcaCase_ownerId_idx" ON "PdcaCase"("ownerId");

-- CreateIndex
CREATE INDEX "PdcaCase_createdById_idx" ON "PdcaCase"("createdById");

-- CreateIndex
CREATE INDEX "PdcaCase_dueAt_idx" ON "PdcaCase"("dueAt");

-- CreateIndex
CREATE INDEX "PdcaLog_pdcaCaseId_createdAt_idx" ON "PdcaLog"("pdcaCaseId", "createdAt");

-- CreateIndex
CREATE INDEX "PdcaLog_createdById_idx" ON "PdcaLog"("createdById");

-- AddForeignKey
ALTER TABLE "PdcaCase" ADD CONSTRAINT "PdcaCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdcaCase" ADD CONSTRAINT "PdcaCase_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdcaCase" ADD CONSTRAINT "PdcaCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdcaLog" ADD CONSTRAINT "PdcaLog_pdcaCaseId_fkey" FOREIGN KEY ("pdcaCaseId") REFERENCES "PdcaCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdcaLog" ADD CONSTRAINT "PdcaLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
