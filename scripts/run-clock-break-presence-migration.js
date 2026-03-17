/**
 * Safe migration: adds clock/break columns and ON_BREAK, IN_MEETING enum values.
 * Run: node scripts/run-clock-break-presence-migration.js
 */
import 'dotenv/config';
import { prisma } from '../prismaClient.js';

async function run() {
  // Add enum value; ignore if already exists (avoids Prisma logging duplicate errors)
  const addEnum = async (value) => {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TYPE "PresenceStatus" ADD VALUE '${value}';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
  };
  await addEnum('ON_BREAK');
  await addEnum('IN_MEETING');
  await prisma.$executeRawUnsafe('ALTER TABLE "counselor_presence" ADD COLUMN IF NOT EXISTS "clockInAt" TIMESTAMP(3);');
  await prisma.$executeRawUnsafe('ALTER TABLE "counselor_presence" ADD COLUMN IF NOT EXISTS "clockOutAt" TIMESTAMP(3);');
  await prisma.$executeRawUnsafe('ALTER TABLE "counselor_presence" ADD COLUMN IF NOT EXISTS "breakStartAt" TIMESTAMP(3);');
  await prisma.$executeRawUnsafe('ALTER TABLE "counselor_presence" ADD COLUMN IF NOT EXISTS "breakEndAt" TIMESTAMP(3);');
  await prisma.$executeRawUnsafe('ALTER TABLE "counselor_presence" ADD COLUMN IF NOT EXISTS "breakReason" TEXT;');
  console.log('Clock/break presence migration completed.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
