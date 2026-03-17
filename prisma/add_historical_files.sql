-- Add only the Historical Admissions & Publicity table and enum.
-- Run this in your database (e.g. Neon SQL Editor) to avoid dropping existing tables/columns.
-- Then run: npx prisma generate

-- Enum for file status
DO $$ BEGIN
  CREATE TYPE "HistoricalFileStatus" AS ENUM ('PENDING', 'VERIFIED', 'LOCKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Table for historical file uploads
CREATE TABLE IF NOT EXISTS "historical_files" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "institutionId" TEXT NOT NULL,
  "fileName"      TEXT NOT NULL,
  "fileType"      TEXT NOT NULL,
  "fileUrl"       TEXT NOT NULL,
  "fileSize"      INTEGER,
  "academicYear"  TEXT,
  "category"      TEXT NOT NULL,
  "description"   TEXT,
  "parsedData"    JSONB,
  "extractedText" TEXT,
  "status"        "HistoricalFileStatus" NOT NULL DEFAULT 'PENDING',
  "uploadedById"  TEXT NOT NULL,
  "uploadedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedById"  TEXT,
  "verifiedAt"    TIMESTAMP(3),

  CONSTRAINT "historical_files_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "historical_files_uploadedById_fkey"  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "historical_files_institutionId_idx" ON "historical_files"("institutionId");
CREATE INDEX IF NOT EXISTS "historical_files_status_idx" ON "historical_files"("status");
CREATE INDEX IF NOT EXISTS "historical_files_uploadedAt_idx" ON "historical_files"("uploadedAt");
