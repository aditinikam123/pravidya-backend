/**
 * Safe migration: adds only missedCallReasonType to counseling_sessions.
 * Does not modify or drop any existing columns or data.
 *
 * Run: node scripts/run-missed-call-reason-migration.js
 */
import 'dotenv/config';
import { prisma } from '../prismaClient.js';

const sql = `ALTER TABLE "counseling_sessions" ADD COLUMN IF NOT EXISTS "missedCallReasonType" TEXT;`;

async function run() {
  await prisma.$executeRawUnsafe(sql);
  console.log('Missed call reason column added. No existing data was changed.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
