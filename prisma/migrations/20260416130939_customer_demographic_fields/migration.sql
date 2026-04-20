-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('LA_JOYA', 'LA_JOYA_PERLA', 'LA_JOYA_PERLA_II', 'LAGOON_VERDE');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "birthday" TIMESTAMP(3),
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "idDocumentName" TEXT,
ADD COLUMN     "idDocumentUrl" TEXT,
ADD COLUMN     "job" TEXT,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "project" "ProjectType";

-- CreateTable
CREATE TABLE "CustomerUnitSelection" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "project" "ProjectType" NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerUnitSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerUnitSelection_customerId_idx" ON "CustomerUnitSelection"("customerId");

-- AddForeignKey
ALTER TABLE "CustomerUnitSelection" ADD CONSTRAINT "CustomerUnitSelection_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
