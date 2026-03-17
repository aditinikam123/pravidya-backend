-- Parent Feedback: add columns to leads + create parent_feedback table.
-- Run in Neon SQL Editor (or psql), then run: npx prisma generate

-- Enum for feedback status on lead
DO $$ BEGIN
  CREATE TYPE "FeedbackStatus" AS ENUM ('NOT_SENT', 'SENT', 'SUBMITTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add columns to leads (skip if already exist)
DO $$ BEGIN
  ALTER TABLE "leads" ADD COLUMN "feedbackStatus" "FeedbackStatus" NOT NULL DEFAULT 'NOT_SENT';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "leads" ADD COLUMN "counselingCompletedAt" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "leads" ADD COLUMN "feedbackSentAt" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "leads" ADD COLUMN "feedbackSubmittedAt" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "leads" ADD COLUMN "feedbackToken" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "leads_feedbackToken_key" ON "leads"("feedbackToken") WHERE "feedbackToken" IS NOT NULL;

-- Parent feedback table
CREATE TABLE IF NOT EXISTS "parent_feedback" (
  "id"                   TEXT NOT NULL PRIMARY KEY,
  "leadId"               TEXT NOT NULL UNIQUE,
  "studentName"          TEXT NOT NULL,
  "parentName"           TEXT NOT NULL,
  "email"                TEXT NOT NULL,
  "phone"                TEXT NOT NULL,
  "counselorId"          TEXT NOT NULL,
  "institutionId"        TEXT NOT NULL,
  "experienceRating"     INTEGER NOT NULL,
  "explanationRating"    INTEGER NOT NULL,
  "helpfulnessRating"    INTEGER NOT NULL,
  "questionsAnswered"    BOOLEAN NOT NULL,
  "professionalismRating" INTEGER NOT NULL,
  "interestLevel"        TEXT NOT NULL,
  "admissionDecision"    TEXT NOT NULL,
  "concern"              TEXT,
  "likedFeedback"        TEXT,
  "improvementFeedback"  TEXT,
  "recommend"            BOOLEAN NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "parent_feedback_leadId_fkey"       FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "parent_feedback_counselorId_fkey"  FOREIGN KEY ("counselorId") REFERENCES "counselor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "parent_feedback_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "parent_feedback_counselorId_idx" ON "parent_feedback"("counselorId");
CREATE INDEX IF NOT EXISTS "parent_feedback_institutionId_idx" ON "parent_feedback"("institutionId");
CREATE INDEX IF NOT EXISTS "parent_feedback_createdAt_idx" ON "parent_feedback"("createdAt");
