-- The module stores one versioned graph. Actor snapshots survive account removal.
BEGIN;

CREATE TABLE "DigitalMapDocument" (
    "id" TEXT NOT NULL DEFAULT 'dnd-digital-map',
    "name" TEXT NOT NULL,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "updatedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitalMapDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DigitalMapDocument_singleton" CHECK ("id" = 'dnd-digital-map'),
    CONSTRAINT "DigitalMapDocument_version_positive" CHECK ("version" > 0),
    CONSTRAINT "DigitalMapDocument_nodes_array" CHECK (jsonb_typeof("nodes") = 'array'),
    CONSTRAINT "DigitalMapDocument_edges_array" CHECK (jsonb_typeof("edges") = 'array')
);

-- Infrastructure is available through the role-checked Nest API only.
-- Prisma connects as the owner; direct Supabase clients have no access policy.
ALTER TABLE "DigitalMapDocument" ENABLE ROW LEVEL SECURITY;

COMMIT;
