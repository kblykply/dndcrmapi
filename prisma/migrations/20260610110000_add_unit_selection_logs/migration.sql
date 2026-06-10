CREATE TABLE "CustomerUnitSelectionLog" (
  "id" TEXT NOT NULL,
  "unitSelectionId" TEXT NOT NULL,
  "section" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "oldValue" TEXT,
  "newValue" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerUnitSelectionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerUnitSelectionLog_unitSelectionId_createdAt_idx" ON "CustomerUnitSelectionLog"("unitSelectionId", "createdAt");
CREATE INDEX "CustomerUnitSelectionLog_createdById_idx" ON "CustomerUnitSelectionLog"("createdById");
CREATE INDEX "CustomerUnitSelectionLog_section_idx" ON "CustomerUnitSelectionLog"("section");

ALTER TABLE "CustomerUnitSelectionLog"
  ADD CONSTRAINT "CustomerUnitSelectionLog_unitSelectionId_fkey"
  FOREIGN KEY ("unitSelectionId") REFERENCES "CustomerUnitSelection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerUnitSelectionLog"
  ADD CONSTRAINT "CustomerUnitSelectionLog_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
