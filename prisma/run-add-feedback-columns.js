/**
 * Run this once to add missing columns (feedbackStatus etc.) to your database.
 * Usage: node prisma/run-add-feedback-columns.js
 * Requires: DATABASE_URL in .env
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const statements = [
  `DO $$ BEGIN CREATE TYPE "FeedbackStatus" AS ENUM ('NOT_SENT', 'SENT', 'SUBMITTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "feedbackStatus" "FeedbackStatus" NOT NULL DEFAULT 'NOT_SENT'`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "counselingCompletedAt" TIMESTAMP(3)`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "feedbackSentAt" TIMESTAMP(3)`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "feedbackSubmittedAt" TIMESTAMP(3)`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "feedbackToken" TEXT`,
  `ALTER TABLE "counselor_profiles" ADD COLUMN IF NOT EXISTS "staticMeetLink" TEXT`,
  `ALTER TABLE "counseling_sessions" ADD COLUMN IF NOT EXISTS "meetingLink" TEXT`,
];

async function run() {
  console.log('Adding missing columns...');
  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log('OK:', sql.slice(0, 60) + '...');
    } catch (e) {
      if (e.message && (e.message.includes('already exists') || e.message.includes('duplicate'))) {
        console.log('Skip (exists):', sql.slice(0, 50) + '...');
      } else {
        console.error('Failed:', sql);
        console.error(e.message);
        process.exit(1);
      }
    }
  }
  try {
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "leads_feedbackToken_key" ON "leads"("feedbackToken") WHERE "feedbackToken" IS NOT NULL`);
    console.log('OK: leads_feedbackToken_key index');
  } catch (e) {
    if (e.message && e.message.includes('already exists')) console.log('Skip: index exists');
    else console.warn('Index warning:', e.message);
  }
  console.log('Done. Run: npx prisma generate');
  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
