/*
  Warnings:

  - Made the column `storagePath` on table `CustomerDocument` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "CustomerDocument" ALTER COLUMN "storagePath" SET NOT NULL;
