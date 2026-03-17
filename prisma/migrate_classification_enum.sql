-- Backward-compatible migration: Lead Classification enum
-- Run this ONCE before deploying the new schema.
-- From backend folder: npx prisma db execute --file prisma/migrate_classification_enum.sql
-- Then run: npx prisma generate
-- Mapping: RAW -> NEW, VERIFIED -> COUNSELING_IN_PROGRESS, PRIORITY -> PRIORITY, status=ENROLLED -> ADMISSION_CONFIRMED

-- 1. Create new enum type
CREATE TYPE "Classification_new" AS ENUM ('NEW', 'COUNSELING_IN_PROGRESS', 'PRIORITY', 'ADMISSION_CONFIRMED');

-- 2. Add temporary column
ALTER TABLE "leads" ADD COLUMN "classification_new" "Classification_new";

-- 3. Migrate data: RAW->NEW, VERIFIED->COUNSELING_IN_PROGRESS, PRIORITY->PRIORITY, ENROLLED status->ADMISSION_CONFIRMED
UPDATE "leads"
SET "classification_new" = CASE
  WHEN "status" = 'ENROLLED' THEN 'ADMISSION_CONFIRMED'::"Classification_new"
  WHEN "classification"::text = 'RAW' THEN 'NEW'::"Classification_new"
  WHEN "classification"::text = 'VERIFIED' THEN 'COUNSELING_IN_PROGRESS'::"Classification_new"
  WHEN "classification"::text = 'PRIORITY' THEN 'PRIORITY'::"Classification_new"
  ELSE 'NEW'::"Classification_new"
END;

-- 4. Drop old column and default
ALTER TABLE "leads" ALTER COLUMN "classification" DROP DEFAULT;
ALTER TABLE "leads" DROP COLUMN "classification";

-- 5. Rename new column
ALTER TABLE "leads" RENAME COLUMN "classification_new" TO "classification";

-- 6. Drop old enum and rename new one
DROP TYPE "Classification";
ALTER TYPE "Classification_new" RENAME TO "Classification";

-- 7. Set default
ALTER TABLE "leads" ALTER COLUMN "classification" SET DEFAULT 'NEW'::"Classification";
