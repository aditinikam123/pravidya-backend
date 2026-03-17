import { prisma } from '../prisma/client.js';

/**
 * One-time helper script:
 * Set source = 'manual_entry' (shown as "Excel Import" in the admin chart)
 * for all existing leads where source is currently NULL.
 *
 * Usage:
 *   cd backend
 *   node scripts/backfillLeadSourceToExcelImport.js
 */
async function main() {
  console.log('🔄 Backfilling lead.source to "manual_entry" for existing leads with NULL source...');

  const result = await prisma.lead.updateMany({
    where: { source: null },
    data: { source: 'manual_entry' },
  });

  console.log(`✅ Updated ${result.count} leads. All existing leads now have source = "manual_entry".`);
}

main()
  .catch((err) => {
    console.error('❌ Error backfilling lead sources:', err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

