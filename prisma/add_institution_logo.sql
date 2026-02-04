-- Institution logo (URL or path)
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
