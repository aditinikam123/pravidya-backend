/**
 * Seed app_settings table with default form field configs.
 * Run: node scripts/seedAppSettings.js
 * Creates the app_settings table if it doesn't exist, then seeds it (raw SQL - no Prisma model needed).
 */
import dotenv from 'dotenv';
import { PrismaClient, Prisma } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "app_settings" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "app_settings_key_key" UNIQUE ("key")
);
`;

const ADD_CUSTOM_DATA_COLUMNS = [
  `ALTER TABLE "counselor_profiles" ADD COLUMN IF NOT EXISTS "customData" JSONB;`,
  `ALTER TABLE "institutions" ADD COLUMN IF NOT EXISTS "customData" JSONB;`,
  `ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "customData" JSONB;`,
  `ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "customData" JSONB;`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "customData" JSONB;`,
];

const SETTINGS = [
  { key: 'counselorFields', value: { username: true, email: true, password: true, fullName: true, mobile: true, expertise: true, languages: true, availability: true, maxCapacity: true, schoolId: true, customFields: [] } },
  { key: 'institutionFields', value: { name: true, type: true, address: true, city: true, state: true, isActive: true, logoUrl: true, boardsOffered: true, standardsAvailable: true, streamsOffered: true, admissionsOpen: true, boardGradeMap: true, customFields: [] } },
  { key: 'courseFields', value: { name: true, code: true, description: true, institution: true, duration: true, eligibility: true, isActive: true, board: true, standardRange: true, stream: true, seats: true, admissionsOpen: true, customFields: [] } },
  { key: 'schoolFields', value: { name: true, board: true, city: true, state: true, academicYear: true, contactEmail: true, contactPhone: true, address: true, capacity: true, pockets: true, customFields: [] } },
  { key: 'admissionFormFields', value: { parentName: true, parentMobile: true, parentEmail: true, parentCity: true, preferredLanguage: true, studentName: true, dateOfBirth: true, gender: true, currentClass: true, boardUniversity: true, marksPercentage: true, institution: true, course: true, academicYear: true, preferredCounselingMode: true, notes: true, customFields: [] } },
];

async function seed() {
  try {
    console.log('🌱 Creating app_settings table (if needed)...');
    await prisma.$executeRawUnsafe(CREATE_TABLE_SQL);
    console.log('✓ Table ready');
    console.log('🌱 Adding customData columns (if needed)...');
    for (const sql of ADD_CUSTOM_DATA_COLUMNS) {
      await prisma.$executeRawUnsafe(sql);
    }
    console.log('✓ Columns ready');
    console.log('🌱 Seeding app_settings...');
    const now = new Date();
    for (const { key, value } of SETTINGS) {
      const id = `clx_${key.replace(/[A-Z]/g, (c) => c.toLowerCase())}`;
      const valueStr = JSON.stringify(value);
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "app_settings" ("id", "key", "value", "updatedAt")
        VALUES (${id}, ${key}, ${valueStr}::jsonb, ${now})
        ON CONFLICT ("key") DO UPDATE SET "value" = ${valueStr}::jsonb, "updatedAt" = ${now}
      `);
      console.log(`  ✓ ${key}`);
    }
    console.log('✅ App settings seeded successfully.');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
