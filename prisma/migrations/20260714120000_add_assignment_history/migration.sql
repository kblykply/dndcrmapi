CREATE TABLE "CustomerOwnerHistory" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "previousOwnerId" TEXT,
    "newOwnerId" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOwnerHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgencySalesHistory" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "previousSalesId" TEXT,
    "newSalesId" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencySalesHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerOwnerHistory_customerId_createdAt_idx" ON "CustomerOwnerHistory"("customerId", "createdAt");
CREATE INDEX "CustomerOwnerHistory_previousOwnerId_idx" ON "CustomerOwnerHistory"("previousOwnerId");
CREATE INDEX "CustomerOwnerHistory_newOwnerId_idx" ON "CustomerOwnerHistory"("newOwnerId");
CREATE INDEX "CustomerOwnerHistory_changedById_idx" ON "CustomerOwnerHistory"("changedById");

CREATE INDEX "AgencySalesHistory_agencyId_createdAt_idx" ON "AgencySalesHistory"("agencyId", "createdAt");
CREATE INDEX "AgencySalesHistory_previousSalesId_idx" ON "AgencySalesHistory"("previousSalesId");
CREATE INDEX "AgencySalesHistory_newSalesId_idx" ON "AgencySalesHistory"("newSalesId");
CREATE INDEX "AgencySalesHistory_changedById_idx" ON "AgencySalesHistory"("changedById");

ALTER TABLE "CustomerOwnerHistory" ADD CONSTRAINT "CustomerOwnerHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerOwnerHistory" ADD CONSTRAINT "CustomerOwnerHistory_previousOwnerId_fkey" FOREIGN KEY ("previousOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerOwnerHistory" ADD CONSTRAINT "CustomerOwnerHistory_newOwnerId_fkey" FOREIGN KEY ("newOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerOwnerHistory" ADD CONSTRAINT "CustomerOwnerHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgencySalesHistory" ADD CONSTRAINT "AgencySalesHistory_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgencySalesHistory" ADD CONSTRAINT "AgencySalesHistory_previousSalesId_fkey" FOREIGN KEY ("previousSalesId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgencySalesHistory" ADD CONSTRAINT "AgencySalesHistory_newSalesId_fkey" FOREIGN KEY ("newSalesId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgencySalesHistory" ADD CONSTRAINT "AgencySalesHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
