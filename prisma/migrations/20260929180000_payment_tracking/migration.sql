BEGIN;

-- Only workflow metadata is persisted here; financial rows remain in Crm_DND.
CREATE TABLE "PaymentTrackingCase" (
    "key" VARCHAR(64) NOT NULL,
    "sourceIdentity" JSONB NOT NULL,
    "trackingDate" DATE,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "version" INTEGER NOT NULL DEFAULT 1,
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentTrackingCase_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "PaymentTrackingCase_key_check" CHECK ("key" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "PaymentTrackingCase_priority_check" CHECK ("priority" IN ('normal', 'high')),
    CONSTRAINT "PaymentTrackingCase_version_check" CHECK ("version" > 0),
    CONSTRAINT "PaymentTrackingCase_sourceIdentity_check" CHECK (jsonb_typeof("sourceIdentity") = 'object')
);

CREATE TABLE "PaymentTrackingEvent" (
    "id" TEXT NOT NULL,
    "caseKey" VARCHAR(64) NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "beforeDate" DATE,
    "afterDate" DATE,
    "channel" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentTrackingEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentTrackingEvent_type_check" CHECK ("type" IN ('defer', 'reset', 'note', 'assign', 'priority', 'contact')),
    CONSTRAINT "PaymentTrackingEvent_body_check" CHECK ("body" IS NULL OR char_length("body") <= 2000),
    CONSTRAINT "PaymentTrackingEvent_channel_check" CHECK ("channel" IS NULL OR "channel" IN ('email', 'whatsapp', 'phone'))
);

CREATE INDEX "PaymentTrackingCase_trackingDate_idx" ON "PaymentTrackingCase"("trackingDate");
CREATE INDEX "PaymentTrackingCase_assigneeId_trackingDate_idx" ON "PaymentTrackingCase"("assigneeId", "trackingDate");
CREATE INDEX "PaymentTrackingCase_priority_idx" ON "PaymentTrackingCase"("priority");
CREATE INDEX "PaymentTrackingEvent_caseKey_createdAt_id_idx" ON "PaymentTrackingEvent"("caseKey", "createdAt", "id");
CREATE INDEX "PaymentTrackingEvent_actorId_idx" ON "PaymentTrackingEvent"("actorId");

ALTER TABLE "PaymentTrackingCase" ADD CONSTRAINT "PaymentTrackingCase_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentTrackingCase" ADD CONSTRAINT "PaymentTrackingCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentTrackingCase" ADD CONSTRAINT "PaymentTrackingCase_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentTrackingEvent" ADD CONSTRAINT "PaymentTrackingEvent_caseKey_fkey" FOREIGN KEY ("caseKey") REFERENCES "PaymentTrackingCase"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentTrackingEvent" ADD CONSTRAINT "PaymentTrackingEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- API-only access: no direct Supabase client policy or table privileges.
ALTER TABLE "PaymentTrackingCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentTrackingEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PaymentTrackingCase", "PaymentTrackingEvent" FROM PUBLIC;
DO $$
DECLARE client_role TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "PaymentTrackingCase", "PaymentTrackingEvent" FROM %I', client_role);
    END IF;
  END LOOP;
END $$;

COMMIT;
