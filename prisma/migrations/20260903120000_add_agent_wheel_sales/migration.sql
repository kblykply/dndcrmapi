CREATE TYPE "AgentWheelSaleType" AS ENUM ('DIRECT', 'AGENCY');

CREATE TABLE "AgentWheelSpin" (
    "id" TEXT NOT NULL,
    "spunById" TEXT,
    "spunByName" TEXT NOT NULL,
    "spunByEmail" TEXT,
    "spunByRole" TEXT NOT NULL,
    "saleType" "AgentWheelSaleType" NOT NULL,
    "agencyId" TEXT,
    "agencyName" TEXT,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "unitSelectionId" TEXT,
    "unitSelectionKey" TEXT NOT NULL,
    "project" "ProjectType" NOT NULL,
    "block" TEXT,
    "unitNumber" TEXT NOT NULL,
    "prizeId" TEXT NOT NULL,
    "prizeNameTr" TEXT NOT NULL,
    "prizeNameEn" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentWheelSpin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentWheelSpin_unitSelectionId_key" ON "AgentWheelSpin"("unitSelectionId");
CREATE UNIQUE INDEX "AgentWheelSpin_unitSelectionKey_key" ON "AgentWheelSpin"("unitSelectionKey");
CREATE INDEX "AgentWheelSpin_spunById_createdAt_idx" ON "AgentWheelSpin"("spunById", "createdAt");
CREATE INDEX "AgentWheelSpin_agencyId_createdAt_idx" ON "AgentWheelSpin"("agencyId", "createdAt");
CREATE INDEX "AgentWheelSpin_customerId_createdAt_idx" ON "AgentWheelSpin"("customerId", "createdAt");
CREATE INDEX "AgentWheelSpin_project_createdAt_idx" ON "AgentWheelSpin"("project", "createdAt");
CREATE INDEX "AgentWheelSpin_prizeId_createdAt_idx" ON "AgentWheelSpin"("prizeId", "createdAt");
CREATE INDEX "AgentWheelSpin_saleType_createdAt_idx" ON "AgentWheelSpin"("saleType", "createdAt");
CREATE INDEX "AgentWheelSpin_createdAt_idx" ON "AgentWheelSpin"("createdAt");

ALTER TABLE "AgentWheelSpin" ADD CONSTRAINT "AgentWheelSpin_spunById_fkey" FOREIGN KEY ("spunById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentWheelSpin" ADD CONSTRAINT "AgentWheelSpin_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentWheelSpin" ADD CONSTRAINT "AgentWheelSpin_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentWheelSpin" ADD CONSTRAINT "AgentWheelSpin_unitSelectionId_fkey" FOREIGN KEY ("unitSelectionId") REFERENCES "CustomerUnitSelection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
