BEGIN;

-- CreateTable
CREATE TABLE "Iso2026Card" (
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

    CONSTRAINT "Iso2026Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Iso2026ChecklistItem" (
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

    CONSTRAINT "Iso2026ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Iso2026Document" (
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

    CONSTRAINT "Iso2026Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Iso2026Log" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "createdById" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Iso2026Log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Iso2026Card_code_key" ON "Iso2026Card"("code");

-- CreateIndex
CREATE INDEX "Iso2026Card_category_idx" ON "Iso2026Card"("category");

-- CreateIndex
CREATE INDEX "Iso2026Card_status_idx" ON "Iso2026Card"("status");

-- CreateIndex
CREATE INDEX "Iso2026Card_sortOrder_idx" ON "Iso2026Card"("sortOrder");

-- CreateIndex
CREATE INDEX "Iso2026ChecklistItem_cardId_idx" ON "Iso2026ChecklistItem"("cardId");

-- CreateIndex
CREATE INDEX "Iso2026ChecklistItem_isChecked_idx" ON "Iso2026ChecklistItem"("isChecked");

-- CreateIndex
CREATE INDEX "Iso2026ChecklistItem_dueAt_idx" ON "Iso2026ChecklistItem"("dueAt");

-- CreateIndex
CREATE INDEX "Iso2026Document_cardId_idx" ON "Iso2026Document"("cardId");

-- CreateIndex
CREATE INDEX "Iso2026Document_type_idx" ON "Iso2026Document"("type");

-- CreateIndex
CREATE INDEX "Iso2026Document_status_idx" ON "Iso2026Document"("status");

-- CreateIndex
CREATE INDEX "Iso2026Log_cardId_createdAt_idx" ON "Iso2026Log"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "Iso2026Log_createdById_idx" ON "Iso2026Log"("createdById");

-- CreateIndex
CREATE INDEX "Iso2026Log_action_idx" ON "Iso2026Log"("action");

-- AddForeignKey
ALTER TABLE "Iso2026Card" ADD CONSTRAINT "Iso2026Card_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Iso2026Card" ADD CONSTRAINT "Iso2026Card_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Iso2026ChecklistItem" ADD CONSTRAINT "Iso2026ChecklistItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Iso2026Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Iso2026ChecklistItem" ADD CONSTRAINT "Iso2026ChecklistItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Iso2026ChecklistItem" ADD CONSTRAINT "Iso2026ChecklistItem_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Iso2026Document" ADD CONSTRAINT "Iso2026Document_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Iso2026Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Iso2026Document" ADD CONSTRAINT "Iso2026Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Iso2026Document" ADD CONSTRAINT "Iso2026Document_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Iso2026Log" ADD CONSTRAINT "Iso2026Log_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Iso2026Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Iso2026Log" ADD CONSTRAINT "Iso2026Log_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- API-only tables: direct Supabase client roles have no access policies.
ALTER TABLE "Iso2026Card" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Iso2026ChecklistItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Iso2026Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Iso2026Log" ENABLE ROW LEVEL SECURITY;

COMMIT;
