-- Run this in your database (Neon SQL Editor or psql) to fix:
--   "The column leads.feedbackStatus does not exist"
--   and other missing columns. Then run: npx prisma generate

-- 1) Feedback status enum and columns on leads (parent feedback feature)
DO $$ BEGIN
  CREATE TYPE "FeedbackStatus" AS ENUM ('NOT_SENT', 'SENT', 'SUBMITTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "feedbackStatus" "FeedbackStatus" NOT NULL DEFAULT 'NOT_SENT';
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "counselingCompletedAt" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "feedbackSentAt" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "feedbackSubmittedAt" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "feedbackToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "leads_feedbackToken_key" ON "leads"("feedbackToken") WHERE "feedbackToken" IS NOT NULL;

-- 2) Meet link columns (Google Meet feature)
ALTER TABLE "counselor_profiles" ADD COLUMN IF NOT EXISTS "staticMeetLink" TEXT;
ALTER TABLE "counseling_sessions" ADD COLUMN IF NOT EXISTS "meetingLink" TEXT;
