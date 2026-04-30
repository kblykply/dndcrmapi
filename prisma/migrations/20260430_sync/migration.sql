-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "MeetingOutcome" AS ENUM ('POSITIVE', 'NEGATIVE', 'FOLLOW_UP', 'NO_DECISION', 'WON', 'LOST');

-- AlterTable
ALTER TABLE "AgencyMeeting" ADD COLUMN     "outcome" "MeetingOutcome",
ADD COLUMN     "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED';

-- CreateIndex
CREATE INDEX "AgencyMeeting_agencyId_idx" ON "AgencyMeeting"("agencyId");

-- CreateIndex
CREATE INDEX "AgencyMeeting_assignedSalesId_idx" ON "AgencyMeeting"("assignedSalesId");

-- CreateIndex
CREATE INDEX "AgencyMeeting_createdById_idx" ON "AgencyMeeting"("createdById");

-- CreateIndex
CREATE INDEX "AgencyMeeting_meetingAt_idx" ON "AgencyMeeting"("meetingAt");

-- CreateIndex
CREATE INDEX "AgencyMeeting_status_idx" ON "AgencyMeeting"("status");
