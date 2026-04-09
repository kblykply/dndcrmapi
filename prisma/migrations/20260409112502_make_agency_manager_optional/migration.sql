-- DropForeignKey
ALTER TABLE "Agency" DROP CONSTRAINT "Agency_managerId_fkey";

-- AlterTable
ALTER TABLE "Agency" ALTER COLUMN "managerId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
