-- DropForeignKey
ALTER TABLE "Presentation" DROP CONSTRAINT "Presentation_customerId_fkey";

-- AlterTable
ALTER TABLE "Presentation" ALTER COLUMN "customerId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Presentation" ADD CONSTRAINT "Presentation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
