-- Per grade-range board selection for schools (e.g. 1-5: CBSE, State Board; 6-10: CBSE)
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS "boardsByStandard" JSONB DEFAULT '{}';
