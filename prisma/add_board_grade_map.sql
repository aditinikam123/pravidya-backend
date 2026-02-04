-- Per-board grade mapping for schools: { "CBSE": { "primary": [1,2,3], "middle": [6,7], "high": [9,10] } }
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS "boardGradeMap" JSONB;
