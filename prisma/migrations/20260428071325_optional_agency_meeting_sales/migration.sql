-- DropForeignKey
ALTER TABLE "AgencyMeeting" DROP CONSTRAINT "AgencyMeeting_agencyId_fkey";

-- AlterTable
ALTER TABLE "AgencyMeeting" ADD COLUMN     "assignedSalesId" TEXT,
ALTER COLUMN "agencyId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AgencyMeeting" ADD CONSTRAINT "AgencyMeeting_assignedSalesId_fkey" FOREIGN KEY ("assignedSalesId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyMeeting" ADD CONSTRAINT "AgencyMeeting_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
