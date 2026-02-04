-- Streams with admissions open (for schools offering 11–12): e.g. ["Science", "Commerce"]
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS "admissionsOpenStreams" JSONB;
