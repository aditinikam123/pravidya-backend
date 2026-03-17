#!/usr/bin/env node
/**
 * One-time data repair:
 * Fix legacy invalid values in institutions.type (e.g. 'Academy') that crash Prisma enum decoding.
 *
 * Safe: only updates rows where type is not one of the allowed enum values.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../prismaClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  console.log('Fixing invalid Institution.type values...');

  // Update known bad value(s) and any nulls to a valid default.
  // If your DB column is a TEXT (legacy), this will repair it.
  // If it is a Postgres enum, the DB would not contain invalid values.
  const updated = await prisma.$executeRaw`
    UPDATE "institutions"
    SET "type" = 'School'
    WHERE "type" IS NULL
       OR "type" NOT IN ('School', 'College')
  `;

  console.log('Rows updated:', updated);
}

main()
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  });

