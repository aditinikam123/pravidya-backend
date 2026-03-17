/**
 * One-time migration: create HistoricalAdmission and HistoricalAdmissionImage tables and enums.
 * Run from backend folder: node scripts/runHistoricalAdmissionsMigration.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
    "updatedAt" TIMESTAMP(3) NOT NULL,
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
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'historical_admissions_institutionId_fkey') THEN
      ALTER TABLE "historical_admissions" ADD CONSTRAINT "historical_admissions_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'historical_admissions_courseId_fkey') THEN
      ALTER TABLE "historical_admissions" ADD CONSTRAINT "historical_admissions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'historical_admission_images_historicalAdmissionId_fkey') THEN
      ALTER TABLE "historical_admission_images" ADD CONSTRAINT "historical_admission_images_historicalAdmissionId_fkey" FOREIGN KEY ("historicalAdmissionId") REFERENCES "historical_admissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS "historical_admissions_institutionId_idx" ON "historical_admissions"("institutionId")`,
  `CREATE INDEX IF NOT EXISTS "historical_admissions_courseId_idx" ON "historical_admissions"("courseId")`,
  `CREATE INDEX IF NOT EXISTS "historical_admissions_category_idx" ON "historical_admissions"("category")`,
  `CREATE INDEX IF NOT EXISTS "historical_admissions_status_idx" ON "historical_admissions"("status")`,
  `CREATE INDEX IF NOT EXISTS "historical_admissions_academicYear_idx" ON "historical_admissions"("academicYear")`,
  `CREATE INDEX IF NOT EXISTS "historical_admission_images_historicalAdmissionId_idx" ON "historical_admission_images"("historicalAdmissionId")`,
];

async function run() {
  console.log('Running Historical Admissions migration...');
  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log('OK:', sql.slice(0, 70) + (sql.length > 70 ? '...' : ''));
    } catch (e) {
      if (e.message && (e.message.includes('already exists') || e.message.includes('duplicate'))) {
        console.log('Skip (exists):', sql.slice(0, 50) + '...');
      } else {
        console.error('Failed:', sql.slice(0, 100));
        console.error(e.message);
        process.exit(1);
      }
    }
  }
  console.log('Done. Run: npx prisma generate');
  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
