BEGIN;

CREATE TABLE "DigitalMapImage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigitalMapImage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DigitalMapImage_size_bounds" CHECK ("size" > 0 AND "size" <= 5242880 AND octet_length("content") = "size"),
    CONSTRAINT "DigitalMapImage_raster_type" CHECK ("mimeType" IN ('image/png', 'image/jpeg', 'image/webp'))
);

-- Screenshots remain private: only the role-checked Nest API serves these bytes.
-- Prisma uses the table owner; direct Supabase clients have no access policy.
ALTER TABLE "DigitalMapImage" ENABLE ROW LEVEL SECURITY;

COMMIT;
