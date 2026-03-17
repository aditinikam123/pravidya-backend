/**
 * Run this to add missing Historical tables WITHOUT resetting the DB.
 * Use when prisma migrate dev keeps asking to reset.
 * 
 * Usage: node scripts/runHistoricalMarketingMigration.js
 */
import { prisma } from '../prisma/client.js';

const statements = [
  // HistoricalFile status enum and table (for Upload Data tab)
  `DO $$ BEGIN CREATE TYPE "HistoricalFileStatus" AS ENUM ('PENDING', 'VERIFIED', 'LOCKED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS "historical_files" (
    "id" TEXT NOT NULL, "institutionId" TEXT NOT NULL, "fileName" TEXT NOT NULL, "fileType" TEXT NOT NULL, "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER, "academicYear" TEXT, "category" TEXT NOT NULL, "description" TEXT, "parsedData" JSONB, "extractedText" TEXT,
    "status" "HistoricalFileStatus" NOT NULL DEFAULT 'PENDING', "uploadedById" TEXT NOT NULL, "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT, "verifiedAt" TIMESTAMP(3),
    CONSTRAINT "historical_files_pkey" PRIMARY KEY ("id")
  )`,
  `DO $$ BEGIN ALTER TABLE "historical_files" ADD CONSTRAINT "historical_files_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN ALTER TABLE "historical_files" ADD CONSTRAINT "historical_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE INDEX IF NOT EXISTS "historical_files_institutionId_idx" ON "historical_files"("institutionId")`,
  `CREATE INDEX IF NOT EXISTS "historical_files_status_idx" ON "historical_files"("status")`,
  `CREATE INDEX IF NOT EXISTS "historical_files_uploadedAt_idx" ON "historical_files"("uploadedAt")`,
  // Historical Marketing records
  `DO $$ BEGIN CREATE TYPE "HistoricalMarketingStatus" AS ENUM ('DRAFT', 'VERIFIED', 'LOCKED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE IF NOT EXISTS "historical_marketing_records" (
    "id" TEXT NOT NULL, "institutionId" TEXT NOT NULL, "academicYear" TEXT NOT NULL, "courseName" TEXT NOT NULL,
    "totalInquiries" INTEGER NOT NULL DEFAULT 0, "totalApplications" INTEGER NOT NULL DEFAULT 0, "confirmedAdmissions" INTEGER NOT NULL DEFAULT 0,
    "maleCount" INTEGER NOT NULL DEFAULT 0, "femaleCount" INTEGER NOT NULL DEFAULT 0, "zipCode" TEXT, "marketingChannel" TEXT,
    "marketingSpend" DOUBLE PRECISION, "leadsGenerated" INTEGER, "admissionsFromCampaign" INTEGER,
    "status" "HistoricalMarketingStatus" NOT NULL DEFAULT 'DRAFT', "sourceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "historical_marketing_records_pkey" PRIMARY KEY ("id")
  )`,
  `DO $$ BEGIN ALTER TABLE "historical_marketing_records" ADD CONSTRAINT "historical_marketing_records_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE INDEX IF NOT EXISTS "historical_marketing_records_institutionId_idx" ON "historical_marketing_records"("institutionId")`,
  `CREATE INDEX IF NOT EXISTS "historical_marketing_records_academicYear_idx" ON "historical_marketing_records"("academicYear")`,
  `CREATE INDEX IF NOT EXISTS "historical_marketing_records_courseName_idx" ON "historical_marketing_records"("courseName")`,
  `CREATE INDEX IF NOT EXISTS "historical_marketing_records_zipCode_idx" ON "historical_marketing_records"("zipCode")`,
  `CREATE INDEX IF NOT EXISTS "historical_marketing_records_status_idx" ON "historical_marketing_records"("status")`,
];

async function run() {
  try {
    for (const sql of statements) {
      await prisma.$executeRawUnsafe(sql);
    }
    console.log('✅ historical_files and historical_marketing_records tables added successfully.');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
