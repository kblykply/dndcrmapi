/*
  Warnings:

  - You are about to drop the column `fileUrl` on the `CustomerDocument` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "CustomerDocument_type_idx";

-- AlterTable
ALTER TABLE "CustomerDocument" DROP COLUMN "fileUrl",
ADD COLUMN     "storagePath" TEXT;
