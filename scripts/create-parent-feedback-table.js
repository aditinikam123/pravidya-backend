/**
 * Create the parent_feedback table if it does not exist.
 * Run from backend folder: node scripts/create-parent-feedback-table.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CREATE_TABLE = `
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
`;

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS "parent_feedback_counselorId_idx" ON "parent_feedback"("counselorId");`,
  `CREATE INDEX IF NOT EXISTS "parent_feedback_institutionId_idx" ON "parent_feedback"("institutionId");`,
  `CREATE INDEX IF NOT EXISTS "parent_feedback_createdAt_idx" ON "parent_feedback"("createdAt");`,
];

async function main() {
  try {
    await prisma.$executeRawUnsafe(CREATE_TABLE);
    console.log('OK: parent_feedback table created or already exists');
    for (const sql of INDEXES) {
      await prisma.$executeRawUnsafe(sql);
    }
    console.log('OK: indexes created');
  } catch (e) {
    if (e.message && /already exists/i.test(e.message)) {
      console.log('OK: parent_feedback table already exists');
      return;
    }
    throw e;
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
