/**
 * Ensure HistoricalAdmission tables and enums exist (fix "column status does not exist" on startup).
 * Called from server.js after connectDB().
 */
import { prisma } from '../prismaClient.js';

const statements = [
  `DO $$ BEGIN CREATE TYPE "HistoricalAdmissionCategory" AS ENUM ('Admissions', 'Marketing', 'Publicity'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE "HistoricalAdmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VERIFIED', 'LOCKED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS "historical_admissions" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "courseId" TEXT,
    "academicYear" TEXT NOT NULL,
    "category" "HistoricalAdmissionCategory" NOT NULL,
    "status" "HistoricalAdmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "description" TEXT,
    "applicationData" JSONB,
    "marketingData" JSONB,
    "isPlaceholder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "historical_admission_images" (
    "id" TEXT NOT NULL,
    "historicalAdmissionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("id")
  )`,
];

async function runStatements() {
  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      if (!e.message || (!e.message.includes('already exists') && !e.message.includes('duplicate'))) {
        console.warn('[ensureHistoricalAdmissionsSchema]', e.message);
      }
    }
  }
  // Ensure courseId column exists (table may have been created before it was added to schema)
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "historical_admissions" ADD COLUMN IF NOT EXISTS "courseId" TEXT`);
  } catch (_) {}
  // Add FK and indexes only if tables exist (ignore if already exist)
  const optional = [
    `DO $$ BEGIN ALTER TABLE "historical_admissions" ADD CONSTRAINT "historical_admissions_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN ALTER TABLE "historical_admissions" ADD CONSTRAINT "historical_admissions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN ALTER TABLE "historical_admission_images" ADD CONSTRAINT "historical_admission_images_historicalAdmissionId_fkey" FOREIGN KEY ("historicalAdmissionId") REFERENCES "historical_admissions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `CREATE INDEX IF NOT EXISTS "historical_admissions_institutionId_idx" ON "historical_admissions"("institutionId")`,
    `CREATE INDEX IF NOT EXISTS "historical_admissions_courseId_idx" ON "historical_admissions"("courseId")`,
    `CREATE INDEX IF NOT EXISTS "historical_admissions_status_idx" ON "historical_admissions"("status")`,
    `CREATE INDEX IF NOT EXISTS "historical_admission_images_historicalAdmissionId_idx" ON "historical_admission_images"("historicalAdmissionId")`,
  ];
  for (const sql of optional) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (_) {}
  }
}

export async function ensureHistoricalAdmissionsSchema() {
  try {
    await runStatements();
    console.log('✅ Historical Admissions schema ensured');
  } catch (e) {
    console.warn('[ensureHistoricalAdmissionsSchema]', e.message);
  }
}
