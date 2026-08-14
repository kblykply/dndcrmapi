-- CreateEnum
CREATE TYPE "QualityProcessCategory" AS ENUM ('CONTEXT', 'PLANNING', 'LEADERSHIP', 'SUPPORT', 'OPERATIONAL', 'PERFORMANCE', 'IMPROVEMENT', 'CONSTRUCTION', 'REAL_ESTATE_SALES', 'VALUE');

-- CreateEnum
CREATE TYPE "QualityProcessStatus" AS ENUM ('ACTIVE', 'NEEDS_REVIEW', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QualityDocumentType" AS ENUM ('PROCEDURE', 'POLICY', 'FORM', 'CHECKLIST', 'RECORD', 'DRAWING', 'CONTRACT', 'REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "QualityDocumentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'NEEDS_REVIEW', 'ARCHIVED');

-- CreateTable
CREATE TABLE "QualityProcessCard" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "QualityProcessCategory" NOT NULL DEFAULT 'OPERATIONAL',
    "status" "QualityProcessStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerDepartment" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityProcessCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityChecklistItem" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "isChecked" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "checkedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityDocument" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "QualityDocumentType" NOT NULL DEFAULT 'PROCEDURE',
    "status" "QualityDocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" TEXT,
    "ownerDepartment" TEXT,
    "url" TEXT,
    "storagePath" TEXT,
    "fileName" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityProcessLog" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "createdById" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityProcessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QualityProcessCard_code_key" ON "QualityProcessCard"("code");

-- CreateIndex
CREATE INDEX "QualityProcessCard_category_idx" ON "QualityProcessCard"("category");

-- CreateIndex
CREATE INDEX "QualityProcessCard_status_idx" ON "QualityProcessCard"("status");

-- CreateIndex
CREATE INDEX "QualityProcessCard_sortOrder_idx" ON "QualityProcessCard"("sortOrder");

-- CreateIndex
CREATE INDEX "QualityChecklistItem_cardId_idx" ON "QualityChecklistItem"("cardId");

-- CreateIndex
CREATE INDEX "QualityChecklistItem_isChecked_idx" ON "QualityChecklistItem"("isChecked");

-- CreateIndex
CREATE INDEX "QualityChecklistItem_dueAt_idx" ON "QualityChecklistItem"("dueAt");

-- CreateIndex
CREATE INDEX "QualityDocument_cardId_idx" ON "QualityDocument"("cardId");

-- CreateIndex
CREATE INDEX "QualityDocument_type_idx" ON "QualityDocument"("type");

-- CreateIndex
CREATE INDEX "QualityDocument_status_idx" ON "QualityDocument"("status");

-- CreateIndex
CREATE INDEX "QualityProcessLog_cardId_createdAt_idx" ON "QualityProcessLog"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "QualityProcessLog_createdById_idx" ON "QualityProcessLog"("createdById");

-- CreateIndex
CREATE INDEX "QualityProcessLog_action_idx" ON "QualityProcessLog"("action");

-- AddForeignKey
ALTER TABLE "QualityProcessCard" ADD CONSTRAINT "QualityProcessCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityProcessCard" ADD CONSTRAINT "QualityProcessCard_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityChecklistItem" ADD CONSTRAINT "QualityChecklistItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "QualityProcessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityChecklistItem" ADD CONSTRAINT "QualityChecklistItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityChecklistItem" ADD CONSTRAINT "QualityChecklistItem_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityDocument" ADD CONSTRAINT "QualityDocument_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "QualityProcessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityDocument" ADD CONSTRAINT "QualityDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityDocument" ADD CONSTRAINT "QualityDocument_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityProcessLog" ADD CONSTRAINT "QualityProcessLog_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "QualityProcessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityProcessLog" ADD CONSTRAINT "QualityProcessLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
