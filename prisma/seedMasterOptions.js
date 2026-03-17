/**
 * Seed master_options for Voice Call Lead Update wizard.
 * Run: node prisma/seedMasterOptions.js (from backend dir)
 */
import { prisma } from '../prismaClient.js';
import { DEFAULT_MASTER_OPTIONS } from '../data/masterOptionsSeed.js';

async function main() {
  const result = await prisma.masterOption.createMany({ data: DEFAULT_MASTER_OPTIONS, skipDuplicates: true });
  console.log('Master options: added', result.count, 'new (total options in seed:', DEFAULT_MASTER_OPTIONS.length, ')');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
