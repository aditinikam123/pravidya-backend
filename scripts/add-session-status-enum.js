/**
 * Add NOT_CONNECTED to SessionStatus enum only (no full schema push).
 * Run once: node scripts/add-session-status-enum.js
 * Uses Prisma client; load env from .env (dotenv or Prisma loads it).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'NOT_CONNECTED';
    `);
    console.log('OK: SessionStatus enum now includes NOT_CONNECTED');
  } catch (e) {
    const msg = e.message || '';
    if (/already exists/i.test(msg) || /duplicate/i.test(msg)) {
      console.log('OK: NOT_CONNECTED already in SessionStatus enum');
      return;
    }
    try {
      await prisma.$executeRawUnsafe(`ALTER TYPE "SessionStatus" ADD VALUE 'NOT_CONNECTED';`);
      console.log('OK: SessionStatus enum now includes NOT_CONNECTED');
    } catch (e2) {
      if (/already exists/i.test(e2.message || '')) console.log('OK: NOT_CONNECTED already in SessionStatus enum');
      else throw e2;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
