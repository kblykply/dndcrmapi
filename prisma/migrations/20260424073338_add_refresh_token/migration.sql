-- AlterTable
ALTER TABLE "User" ADD COLUMN     "refreshToken" TEXT;

-- CreateIndex
CREATE INDEX "CustomerDocument_customerId_type_idx" ON "CustomerDocument"("customerId", "type");
