BEGIN;

CREATE TYPE "DigitalRecordKind" AS ENUM ('PROJECT', 'PROCESS');
CREATE TYPE "DigitalProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "DigitalProjectPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
CREATE TYPE "DigitalProjectHealth" AS ENUM ('NOT_SET', 'ON_TRACK', 'AT_RISK', 'BLOCKED');
CREATE TYPE "DigitalActivityKind" AS ENUM ('CREATED', 'UPDATED', 'NOTE');

CREATE TABLE "DigitalTeamMember" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "contact" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DigitalTeamMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigitalTeamMember_version_positive" CHECK ("version" > 0),
  CONSTRAINT "DigitalTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DigitalTeamMember_userId_key" ON "DigitalTeamMember"("userId");
CREATE INDEX "DigitalTeamMember_isActive_name_idx" ON "DigitalTeamMember"("isActive", "name");

CREATE TABLE "DigitalProject" (
  "id" TEXT NOT NULL,
  "kind" "DigitalRecordKind" NOT NULL,
  "name" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "status" "DigitalProjectStatus" NOT NULL DEFAULT 'PLANNED',
  "priority" "DigitalProjectPriority" NOT NULL DEFAULT 'NORMAL',
  "health" "DigitalProjectHealth" NOT NULL DEFAULT 'NOT_SET',
  "ownerId" TEXT,
  "startDate" DATE,
  "targetDate" DATE,
  "cadence" TEXT NOT NULL,
  "progress" INTEGER,
  "nextStep" TEXT NOT NULL,
  "links" JSONB NOT NULL,
  "workstreams" JSONB NOT NULL,
  "factors" JSONB NOT NULL,
  "linkCount" INTEGER NOT NULL DEFAULT 0,
  "workstreamCount" INTEGER NOT NULL DEFAULT 0,
  "doneWorkstreamCount" INTEGER NOT NULL DEFAULT 0,
  "openFactorCount" INTEGER NOT NULL DEFAULT 0,
  "blockingFactorCount" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "updatedByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DigitalProject_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigitalProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "DigitalTeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DigitalProject_version_positive" CHECK ("version" > 0),
  CONSTRAINT "DigitalProject_progress_range" CHECK ("progress" IS NULL OR "progress" BETWEEN 0 AND 100),
  CONSTRAINT "DigitalProject_process_progress_null" CHECK ("kind" <> 'PROCESS' OR "progress" IS NULL),
  CONSTRAINT "DigitalProject_completed_progress" CHECK ("status" <> 'COMPLETED' OR "progress" IS NULL OR "progress" = 100),
  CONSTRAINT "DigitalProject_dates_ordered" CHECK ("startDate" IS NULL OR "targetDate" IS NULL OR "startDate" <= "targetDate"),
  CONSTRAINT "DigitalProject_links_bounded" CHECK (jsonb_typeof("links") = 'array' AND jsonb_array_length("links") <= 20),
  CONSTRAINT "DigitalProject_workstreams_bounded" CHECK (jsonb_typeof("workstreams") = 'array' AND jsonb_array_length("workstreams") <= 50),
  CONSTRAINT "DigitalProject_factors_bounded" CHECK (jsonb_typeof("factors") = 'array' AND jsonb_array_length("factors") <= 30),
  CONSTRAINT "DigitalProject_counts_nonnegative" CHECK ("linkCount" >= 0 AND "workstreamCount" >= 0 AND "doneWorkstreamCount" BETWEEN 0 AND "workstreamCount" AND "openFactorCount" >= 0 AND "blockingFactorCount" BETWEEN 0 AND "openFactorCount")
);
CREATE INDEX "DigitalProject_status_updatedAt_idx" ON "DigitalProject"("status", "updatedAt");
CREATE INDEX "DigitalProject_ownerId_idx" ON "DigitalProject"("ownerId");

CREATE TABLE "DigitalProjectActivity" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "kind" "DigitalActivityKind" NOT NULL,
  "body" TEXT NOT NULL,
  "changedFields" TEXT[] NOT NULL,
  "projectVersion" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DigitalProjectActivity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigitalProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DigitalProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DigitalProjectActivity_version_positive" CHECK ("projectVersion" > 0)
);
CREATE INDEX "DigitalProjectActivity_projectId_createdAt_id_idx" ON "DigitalProjectActivity"("projectId", "createdAt", "id");
CREATE INDEX "DigitalProjectActivity_projectId_kind_createdAt_idx" ON "DigitalProjectActivity"("projectId", "kind", "createdAt");

-- All records are served by the active-ADMIN-checked Nest API, never by public clients.
ALTER TABLE "DigitalTeamMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DigitalProject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DigitalProjectActivity" ENABLE ROW LEVEL SECURITY;

COMMIT;
