/*
  Warnings:

  - The `issueCategory` column on the `PdcaCase` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `impactLevel` column on the `PdcaCase` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "PdcaCase" DROP COLUMN "issueCategory",
ADD COLUMN     "issueCategory" "PdcaIssueCategory",
DROP COLUMN "impactLevel",
ADD COLUMN     "impactLevel" "PdcaImpactLevel";
