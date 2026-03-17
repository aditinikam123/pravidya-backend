/**
 * Remove the obsolete 20250219000000_session_lifecycle migration record from _prisma_migrations.
 * This migration was renamed to 20260127110922_session_lifecycle (runs after init).
 *
 * Run: node scripts/resolve-migration-20250219.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$executeRawUnsafe(`
    DELETE FROM "_prisma_migrations"
    WHERE migration_name = '20250219000000_session_lifecycle'
  `);
  console.log('Removed migration record:', result >= 0 ? 'OK' : result);
  if (result > 0) {
    console.log(`Deleted ${result} row(s). You can now run: npx prisma migrate dev --name add_historical_verification`);
  } else {
    console.log('No matching record found (may already be removed).');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
