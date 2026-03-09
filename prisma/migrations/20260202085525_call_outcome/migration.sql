-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('OPENED', 'NO_ANSWER', 'BUSY', 'UNREACHABLE', 'CALL_AGAIN', 'INTERESTED', 'NOT_INTERESTED', 'QUALIFIED', 'WON', 'LOST', 'WRONG_NUMBER');

-- AlterTable
ALTER TABLE "LeadActivity" ADD COLUMN     "callOutcome" "CallOutcome";

-- CreateIndex
CREATE INDEX "LeadActivity_callOutcome_idx" ON "LeadActivity"("callOutcome");
