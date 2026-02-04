-- Per-grade admissions open: which specific grades (1–12) have admissions open, e.g. [2] or [1,2,6,7]
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS "admissionsOpenGrades" JSONB;
