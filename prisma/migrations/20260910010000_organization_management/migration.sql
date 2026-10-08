BEGIN;

-- CreateEnum
CREATE TYPE "OrgNodeKind" AS ENUM ('COMPANY', 'DEPARTMENT', 'POSITION', 'TEAM');

-- CreateEnum
CREATE TYPE "OrgDefinitionStatus" AS ENUM ('DRAFT', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrgProcessResponsibility" AS ENUM ('RESPONSIBLE', 'ACCOUNTABLE', 'CONSULTED', 'INFORMED');

-- DropForeignKey
ALTER TABLE "OrgChartNode" DROP CONSTRAINT "OrgChartNode_parentId_fkey";

-- AlterTable
ALTER TABLE "OrgChartNode" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedRevision" INTEGER,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "authority" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "competencies" TEXT,
ADD COLUMN     "kind" "OrgNodeKind" NOT NULL DEFAULT 'POSITION',
ADD COLUMN     "performanceIndicators" TEXT,
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "responsibilities" TEXT,
ADD COLUMN     "reviewDueAt" DATE,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "status" "OrgDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "OrgProcessLink" (
    "nodeId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "responsibility" "OrgProcessResponsibility" NOT NULL DEFAULT 'RESPONSIBLE',

    CONSTRAINT "OrgProcessLink_pkey" PRIMARY KEY ("nodeId","cardId")
);

-- CreateTable
CREATE TABLE "OrgChartLog" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgChartLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgProcessLink_cardId_idx" ON "OrgProcessLink"("cardId");

-- CreateIndex
CREATE INDEX "OrgChartLog_nodeId_createdAt_idx" ON "OrgChartLog"("nodeId", "createdAt");

-- CreateIndex
CREATE INDEX "OrgChartLog_actorId_idx" ON "OrgChartLog"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgChartNode_code_key" ON "OrgChartNode"("code");

-- CreateIndex
CREATE INDEX "OrgChartNode_assigneeId_idx" ON "OrgChartNode"("assigneeId");

-- CreateIndex
CREATE INDEX "OrgChartNode_status_kind_idx" ON "OrgChartNode"("status", "kind");

-- AddForeignKey
ALTER TABLE "OrgChartNode" ADD CONSTRAINT "OrgChartNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgChartNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgChartNode" ADD CONSTRAINT "OrgChartNode_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgChartNode" ADD CONSTRAINT "OrgChartNode_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgProcessLink" ADD CONSTRAINT "OrgProcessLink_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OrgChartNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgProcessLink" ADD CONSTRAINT "OrgProcessLink_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "QualityProcessCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgChartLog" ADD CONSTRAINT "OrgChartLog_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OrgChartNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgChartLog" ADD CONSTRAINT "OrgChartLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep the original titles and legacy type/color metadata. No users are assigned automatically.
UPDATE "OrgChartNode" SET "kind" = 'DEPARTMENT'
WHERE lower(coalesce("type", '')) IN ('department', 'departments');
UPDATE "OrgChartNode" SET "kind" = 'TEAM'
WHERE lower(coalesce("type", '')) IN ('team', 'group');
UPDATE "OrgChartNode" SET "kind" = 'COMPANY'
WHERE lower(coalesce("type", '')) = 'company';

-- Establish the first auditable revision for existing records without inventing prior history.
INSERT INTO "OrgChartLog" ("id", "nodeId", "actorName", "action", "afterJson")
SELECT 'org-baseline-' || n."id", n."id", 'System', 'MIGRATED',
       to_jsonb(n) || '{"assignee":null,"approvedBy":null,"processes":[]}'::jsonb
FROM "OrgChartNode" n;

COMMIT;
