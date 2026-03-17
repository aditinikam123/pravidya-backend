/**
 * Seed default call dispositions for lead calls feature
 * Run: node scripts/seedCallDispositions.js
 */
import { prisma } from '../prisma/client.js';

const DISPOSITIONS = [
  { name: 'Connected', sortOrder: 1 },
  { name: 'No Answer', sortOrder: 2 },
  { name: 'Busy', sortOrder: 3 },
  { name: 'Wrong Number', sortOrder: 4 },
  { name: 'Callback Requested', sortOrder: 5 },
  { name: 'Not Interested', sortOrder: 6 },
  { name: 'Interested', sortOrder: 7 },
  { name: 'Other', sortOrder: 99 },
];

async function main() {
  for (const d of DISPOSITIONS) {
    await prisma.callDisposition.upsert({
      where: { name: d.name },
      create: { name: d.name, sortOrder: d.sortOrder },
      update: { sortOrder: d.sortOrder },
    });
  }
  console.log(`Seeded ${DISPOSITIONS.length} call dispositions`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
