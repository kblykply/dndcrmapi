BEGIN;

-- CreateEnum
CREATE TYPE "ItTicketType" AS ENUM ('INCIDENT', 'REQUEST');

-- CreateEnum
CREATE TYPE "ItTicketCategory" AS ENUM ('HARDWARE', 'SOFTWARE', 'ACCESS', 'NETWORK', 'EMAIL', 'WEBSITE', 'DATA', 'OTHER');

-- CreateEnum
CREATE TYPE "ItTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ItTicketImpact" AS ENUM ('SINGLE', 'TEAM', 'COMPANY');

-- CreateEnum
CREATE TYPE "ItTicketUrgency" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "ItTicketStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'WAITING_REQUESTER', 'WAITING_VENDOR', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ItEntryVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "ItEntryKind" AS ENUM ('CREATED', 'REPLY', 'NOTE', 'STATUS', 'UPDATED');

-- CreateTable
CREATE TABLE "ItTicket" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "ItTicketType" NOT NULL,
    "category" "ItTicketCategory" NOT NULL,
    "priority" "ItTicketPriority" NOT NULL,
    "impact" "ItTicketImpact" NOT NULL,
    "urgency" "ItTicketUrgency" NOT NULL,
    "status" "ItTicketStatus" NOT NULL DEFAULT 'NEW',
    "system" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "requesterId" TEXT,
    "requesterName" TEXT NOT NULL,
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "resolution" TEXT NOT NULL DEFAULT '',
    "dueAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publicUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItTicketEntry" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "kind" "ItEntryKind" NOT NULL,
    "visibility" "ItEntryVisibility" NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "status" "ItTicketStatus",
    "changedFields" TEXT[] NOT NULL,
    "ticketVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItTicketEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItTicketAttachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItTicketAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItTicket_number_key" ON "ItTicket"("number");

-- CreateIndex
CREATE INDEX "ItTicket_requesterId_publicUpdatedAt_idx" ON "ItTicket"("requesterId", "publicUpdatedAt");

-- CreateIndex
CREATE INDEX "ItTicket_assigneeId_status_updatedAt_idx" ON "ItTicket"("assigneeId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ItTicket_status_updatedAt_idx" ON "ItTicket"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ItTicket_dueAt_idx" ON "ItTicket"("dueAt");

-- CreateIndex
CREATE INDEX "ItTicketEntry_ticketId_visibility_createdAt_id_idx" ON "ItTicketEntry"("ticketId", "visibility", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ItTicketEntry_id_ticketId_key" ON "ItTicketEntry"("id", "ticketId");

-- CreateIndex
CREATE INDEX "ItTicketAttachment_ticketId_idx" ON "ItTicketAttachment"("ticketId");

-- CreateIndex
CREATE INDEX "ItTicketAttachment_entryId_idx" ON "ItTicketAttachment"("entryId");

-- AddForeignKey
ALTER TABLE "ItTicket" ADD CONSTRAINT "ItTicket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItTicket" ADD CONSTRAINT "ItTicket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItTicketEntry" ADD CONSTRAINT "ItTicketEntry_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ItTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItTicketEntry" ADD CONSTRAINT "ItTicketEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItTicketAttachment" ADD CONSTRAINT "ItTicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ItTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItTicketAttachment" ADD CONSTRAINT "ItTicketAttachment_entryId_ticketId_fkey" FOREIGN KEY ("entryId", "ticketId") REFERENCES "ItTicketEntry"("id", "ticketId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ItTicket" ADD CONSTRAINT "ItTicket_version_positive" CHECK ("version" > 0);
ALTER TABLE "ItTicket" ADD CONSTRAINT "ItTicket_text_bounds" CHECK (char_length("subject") BETWEEN 1 AND 160 AND char_length("description") BETWEEN 1 AND 10000 AND char_length("system") <= 160 AND char_length("location") <= 160 AND char_length("resolution") <= 5000);
ALTER TABLE "ItTicket" ADD CONSTRAINT "ItTicket_resolution_required" CHECK ("status" <> 'RESOLVED' OR (char_length(btrim("resolution")) > 0 AND "resolvedAt" IS NOT NULL));
ALTER TABLE "ItTicketEntry" ADD CONSTRAINT "ItTicketEntry_version_positive" CHECK ("ticketVersion" > 0);
ALTER TABLE "ItTicketEntry" ADD CONSTRAINT "ItTicketEntry_body_bounds" CHECK (char_length("body") <= CASE WHEN "kind" = 'CREATED' THEN 10000 ELSE 5000 END);
ALTER TABLE "ItTicketAttachment" ADD CONSTRAINT "ItTicketAttachment_size_bounds" CHECK ("size" BETWEEN 1 AND 5242880 AND octet_length("content") = "size");
ALTER TABLE "ItTicketAttachment" ADD CONSTRAINT "ItTicketAttachment_mime_allowlist" CHECK ("mimeType" IN ('image/png','image/jpeg','image/webp','application/pdf','text/plain'));

-- All access goes through the active-account-checked API. No public policies.
ALTER TABLE "ItTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItTicketEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItTicketAttachment" ENABLE ROW LEVEL SECURITY;
-- PostgreSQL sequences do not support RLS; revoke direct client access instead.
REVOKE ALL ON SEQUENCE "ItTicket_number_seq" FROM PUBLIC;
DO $$
DECLARE client_role TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE "ItTicket_number_seq" FROM %I', client_role);
    END IF;
  END LOOP;
END $$;

COMMIT;
