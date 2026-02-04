-- Institution: school academic structure and admissions status
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS "boardsOffered" TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "standardsAvailable" TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "streamsOffered" TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "admissionsOpen" BOOLEAN;

-- Course: school admission entry fields and seats/admissions
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS "board" TEXT,
  ADD COLUMN IF NOT EXISTS "standardRange" TEXT,
  ADD COLUMN IF NOT EXISTS "stream" TEXT,
  ADD COLUMN IF NOT EXISTS "seats" INTEGER,
  ADD COLUMN IF NOT EXISTS "admissionsOpen" BOOLEAN;
