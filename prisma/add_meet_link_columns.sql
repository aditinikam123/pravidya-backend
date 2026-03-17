-- Add Google Meet link columns (no Google API). Run manually in Neon SQL Editor if needed, then: npx prisma generate

-- Counselor static Meet link (reused for all sessions)
ALTER TABLE "counselor_profiles" ADD COLUMN IF NOT EXISTS "staticMeetLink" TEXT;

-- Session-specific meeting link (stored when session is created)
ALTER TABLE "counseling_sessions" ADD COLUMN IF NOT EXISTS "meetingLink" TEXT;
