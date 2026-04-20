-- CreateTable
CREATE TABLE "OrgChartNode" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "color" TEXT,
    "parentId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgChartNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgChartNode_parentId_idx" ON "OrgChartNode"("parentId");

-- AddForeignKey
ALTER TABLE "OrgChartNode" ADD CONSTRAINT "OrgChartNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgChartNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
