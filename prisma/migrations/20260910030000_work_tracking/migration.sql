BEGIN;
-- CreateEnum
CREATE TYPE "WorkItemKind" AS ENUM ('TASK', 'BUG', 'REQUEST', 'MILESTONE');

-- CreateEnum
CREATE TYPE "WorkMemberRole" AS ENUM ('LEAD', 'MEMBER', 'VIEWER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CrmTaskStatus" ADD VALUE 'BLOCKED';
ALTER TYPE "CrmTaskStatus" ADD VALUE 'IN_REVIEW';

-- AlterEnum
ALTER TYPE "CrmTaskPriority" ADD VALUE 'URGENT';

-- AlterTable
ALTER TABLE "CrmTask" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "estimateMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "WorkItemKind" NOT NULL DEFAULT 'TASK',
ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "startAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "WorkProject" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#147d73',
    "ownerId" TEXT NOT NULL,
    "departmentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkProjectMember" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkMemberRole" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "WorkProjectMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "WorkDependency" (
    "taskId" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,

    CONSTRAINT "WorkDependency_pkey" PRIMARY KEY ("taskId","blockerId")
);

-- CreateTable
CREATE TABLE "WorkChecklistItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkTimeEntry" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "workedOn" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkActivity" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkWatcher" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "WorkWatcher_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkProject_key_key" ON "WorkProject"("key");

-- CreateIndex
CREATE INDEX "WorkProject_departmentId_idx" ON "WorkProject"("departmentId");

-- CreateIndex
CREATE INDEX "WorkProjectMember_userId_idx" ON "WorkProjectMember"("userId");

-- CreateIndex
CREATE INDEX "WorkDependency_blockerId_idx" ON "WorkDependency"("blockerId");

-- CreateIndex
CREATE INDEX "WorkChecklistItem_taskId_idx" ON "WorkChecklistItem"("taskId");

-- CreateIndex
CREATE INDEX "WorkComment_taskId_createdAt_idx" ON "WorkComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkTimeEntry_taskId_workedOn_idx" ON "WorkTimeEntry"("taskId", "workedOn");

-- CreateIndex
CREATE INDEX "WorkAttachment_taskId_idx" ON "WorkAttachment"("taskId");

-- CreateIndex
CREATE INDEX "WorkActivity_taskId_createdAt_idx" ON "WorkActivity"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkWatcher_userId_idx" ON "WorkWatcher"("userId");

-- CreateIndex
CREATE INDEX "CrmTask_projectId_archivedAt_status_idx" ON "CrmTask"("projectId", "archivedAt", "status");

-- CreateIndex
CREATE INDEX "CrmTask_parentId_idx" ON "CrmTask"("parentId");

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WorkProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CrmTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkProject" ADD CONSTRAINT "WorkProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkProject" ADD CONSTRAINT "WorkProject_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "OrgChartNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkProjectMember" ADD CONSTRAINT "WorkProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WorkProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkProjectMember" ADD CONSTRAINT "WorkProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkDependency" ADD CONSTRAINT "WorkDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CrmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkDependency" ADD CONSTRAINT "WorkDependency_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "CrmTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkChecklistItem" ADD CONSTRAINT "WorkChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CrmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkComment" ADD CONSTRAINT "WorkComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CrmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkComment" ADD CONSTRAINT "WorkComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTimeEntry" ADD CONSTRAINT "WorkTimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CrmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTimeEntry" ADD CONSTRAINT "WorkTimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAttachment" ADD CONSTRAINT "WorkAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CrmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAttachment" ADD CONSTRAINT "WorkAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkActivity" ADD CONSTRAINT "WorkActivity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CrmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkActivity" ADD CONSTRAINT "WorkActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkWatcher" ADD CONSTRAINT "WorkWatcher_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CrmTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkWatcher" ADD CONSTRAINT "WorkWatcher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkProject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkProjectMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkDependency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkChecklistItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkTimeEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkWatcher" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkTimeEntry" ADD CONSTRAINT "WorkTimeEntry_minutes_check" CHECK ("minutes" BETWEEN 1 AND 1440);
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_estimate_check" CHECK ("estimateMinutes" >= 0);
ALTER TABLE "WorkDependency" ADD CONSTRAINT "WorkDependency_not_self" CHECK ("taskId" <> "blockerId");
COMMIT;

