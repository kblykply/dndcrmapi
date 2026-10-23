BEGIN;
-- CreateTable
CREATE TABLE "ConstructionProject" (
    "id" TEXT NOT NULL,
    "crmProject" "ProjectType" NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionSource" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sourceDate" TIMESTAMP(3),
    "dateBasis" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionTrade" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DECIMAL(8,4) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ConstructionTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionUnit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "scopeNote" TEXT NOT NULL DEFAULT '',
    "sourceRef" TEXT NOT NULL,

    CONSTRAINT "ConstructionUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionProgress" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_DONE',
    "quality" TEXT NOT NULL DEFAULT 'UNCHECKED',
    "note" TEXT NOT NULL DEFAULT '',
    "checkedAt" TIMESTAMP(3),
    "sourceStatus" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConstructionProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionClaim" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractor" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "taxRate" DECIMAL(8,4) NOT NULL,
    "adjustment" DECIMAL(20,6) NOT NULL,
    "adjustmentNote" TEXT NOT NULL DEFAULT '',
    "deduction" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "sourceNet" DECIMAL(20,6),
    "sourceRef" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConstructionClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionClaimLine" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "previousQty" DECIMAL(20,6) NOT NULL,
    "measuredQty" DECIMAL(20,6),
    "acceptedQty" DECIMAL(20,6) NOT NULL,
    "unitPrice" DECIMAL(20,8) NOT NULL,
    "sourceAmount" DECIMAL(20,6),
    "sourceRef" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "measurements" JSONB NOT NULL,

    CONSTRAINT "ConstructionClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionBudget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "sourceTotal" DECIMAL(20,6),
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionBudgetItem" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unitPrice" DECIMAL(20,8) NOT NULL,
    "completedQty" DECIMAL(20,6),
    "paid" DECIMAL(20,6),
    "sourceAmount" DECIMAL(20,6) NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "sourceFormula" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConstructionBudgetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionIssue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "requiredInfo" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConstructionIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConstructionActivity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConstructionActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionProject_crmProject_key" ON "ConstructionProject"("crmProject");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionSource_sha256_key" ON "ConstructionSource"("sha256");

-- CreateIndex
CREATE INDEX "ConstructionSource_projectId_kind_idx" ON "ConstructionSource"("projectId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionTrade_projectId_position_key" ON "ConstructionTrade"("projectId", "position");

-- CreateIndex
CREATE INDEX "ConstructionUnit_projectId_block_position_idx" ON "ConstructionUnit"("projectId", "block", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionUnit_projectId_block_label_key" ON "ConstructionUnit"("projectId", "block", "label");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionProgress_unitId_tradeId_key" ON "ConstructionProgress"("unitId", "tradeId");

-- CreateIndex
CREATE INDEX "ConstructionClaim_projectId_period_idx" ON "ConstructionClaim"("projectId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionClaim_projectId_contractor_number_key" ON "ConstructionClaim"("projectId", "contractor", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionClaimLine_claimId_position_key" ON "ConstructionClaimLine"("claimId", "position");

-- CreateIndex
CREATE INDEX "ConstructionBudget_projectId_idx" ON "ConstructionBudget"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ConstructionBudgetItem_budgetId_position_key" ON "ConstructionBudgetItem"("budgetId", "position");

-- CreateIndex
CREATE INDEX "ConstructionIssue_projectId_status_idx" ON "ConstructionIssue"("projectId", "status");

-- CreateIndex
CREATE INDEX "ConstructionActivity_projectId_createdAt_id_idx" ON "ConstructionActivity"("projectId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ConstructionActivity_entityType_entityId_createdAt_idx" ON "ConstructionActivity"("entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConstructionSource" ADD CONSTRAINT "ConstructionSource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ConstructionProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionTrade" ADD CONSTRAINT "ConstructionTrade_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ConstructionProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionUnit" ADD CONSTRAINT "ConstructionUnit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ConstructionProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionProgress" ADD CONSTRAINT "ConstructionProgress_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "ConstructionUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionProgress" ADD CONSTRAINT "ConstructionProgress_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "ConstructionTrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionClaim" ADD CONSTRAINT "ConstructionClaim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ConstructionProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionClaimLine" ADD CONSTRAINT "ConstructionClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ConstructionClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionBudget" ADD CONSTRAINT "ConstructionBudget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ConstructionProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionBudgetItem" ADD CONSTRAINT "ConstructionBudgetItem_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "ConstructionBudget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionIssue" ADD CONSTRAINT "ConstructionIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ConstructionProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConstructionActivity" ADD CONSTRAINT "ConstructionActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ConstructionProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backend-only access: do not expose construction costs through Supabase REST roles.
ALTER TABLE "ConstructionProject" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConstructionProject" FROM anon, authenticated;
ALTER TABLE "ConstructionSource" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConstructionSource" FROM anon, authenticated;
ALTER TABLE "ConstructionTrade" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConstructionTrade" FROM anon, authenticated;
ALTER TABLE "ConstructionUnit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConstructionUnit" FROM anon, authenticated;
ALTER TABLE "ConstructionProgress" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConstructionProgress" FROM anon, authenticated;
ALTER TABLE "ConstructionClaim" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConstructionClaim" FROM anon, authenticated;
ALTER TABLE "ConstructionClaimLine" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConstructionClaimLine" FROM anon, authenticated;
ALTER TABLE "ConstructionBudget" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConstructionBudget" FROM anon, authenticated;
ALTER TABLE "ConstructionBudgetItem" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConstructionBudgetItem" FROM anon, authenticated;
ALTER TABLE "ConstructionIssue" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConstructionIssue" FROM anon, authenticated;
ALTER TABLE "ConstructionActivity" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConstructionActivity" FROM anon, authenticated;

ALTER TABLE "ConstructionProgress" ADD CONSTRAINT "ConstructionProgress_status_check" CHECK (status IN ('DONE','NOT_DONE','PARTIAL'));
ALTER TABLE "ConstructionProgress" ADD CONSTRAINT "ConstructionProgress_quality_check" CHECK (quality IN ('UNCHECKED','SUITABLE','PARTIAL','UNSUITABLE'));
ALTER TABLE "ConstructionTrade" ADD CONSTRAINT "ConstructionTrade_weight_check" CHECK (weight > 0 AND weight <= 100);
ALTER TABLE "ConstructionIssue" ADD CONSTRAINT "ConstructionIssue_status_check" CHECK (status IN ('OPEN','RESOLVED'));
ALTER TABLE "ConstructionClaim" ADD CONSTRAINT "ConstructionClaim_values_check" CHECK ("taxRate" >= 0 AND "taxRate" <= 100 AND deduction >= 0);
ALTER TABLE "ConstructionClaimLine" ADD CONSTRAINT "ConstructionClaimLine_values_check" CHECK ("previousQty" >= 0 AND "acceptedQty" >= 0 AND "unitPrice" >= 0 AND ("measuredQty" IS NULL OR "measuredQty" >= 0));
ALTER TABLE "ConstructionBudgetItem" ADD CONSTRAINT "ConstructionBudgetItem_values_check" CHECK (quantity >= 0 AND "unitPrice" >= 0 AND ("completedQty" IS NULL OR "completedQty" >= 0) AND (paid IS NULL OR paid >= 0));
COMMIT;
