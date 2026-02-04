-- Per-grade admissions open status for schools (1-5, 6-10, 11-12)
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS "admissionsOpenByStandard" JSONB;
