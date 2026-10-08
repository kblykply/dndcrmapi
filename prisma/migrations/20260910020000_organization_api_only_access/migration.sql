BEGIN;

-- Organization definitions and staff history are private CRM data.
-- Prisma connects as the table owner; direct Supabase client roles receive no policy.
ALTER TABLE "OrgChartNode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgProcessLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgChartLog" ENABLE ROW LEVEL SECURITY;

COMMIT;
