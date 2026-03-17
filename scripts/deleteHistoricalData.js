/**
 * Delete all historical data from the database.
 * Tables cleared (in order): historical_admission_images, historical_admissions, historical_files, historical_marketing_records
 *
 * Run: node scripts/deleteHistoricalData.js
 */
import { prisma } from '../prisma/client.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function deleteHistoricalData() {
  console.log('Starting historical data deletion...');

  try {
    // 1. Delete HistoricalAdmissionImage (depends on HistoricalAdmission)
    const imgCount = await prisma.historicalAdmissionImage.deleteMany({});
    console.log(`Deleted ${imgCount.count} historical admission images`);

    // 2. Delete HistoricalAdmission
    const admCount = await prisma.historicalAdmission.deleteMany({});
    console.log(`Deleted ${admCount.count} historical admissions`);

    // 3. Delete HistoricalFile - first get file paths to optionally delete files from disk
    const files = await prisma.historicalFile.findMany({ select: { fileUrl: true } });
    const fileCount = await prisma.historicalFile.deleteMany({});
    console.log(`Deleted ${fileCount.count} historical files`);

    // 4. Delete HistoricalMarketingRecord
    const mktCount = await prisma.historicalMarketingRecord.deleteMany({});
    console.log(`Deleted ${mktCount.count} historical marketing records`);

    // Optionally delete physical files from uploads/historical-files
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'historical-files');
    if (fs.existsSync(uploadsDir)) {
      try {
        const uploadFiles = fs.readdirSync(uploadsDir);
        let deleted = 0;
        for (const f of uploadFiles) {
          const fp = path.join(uploadsDir, f);
          if (fs.statSync(fp).isFile()) {
            fs.unlinkSync(fp);
            deleted++;
          }
        }
        console.log(`Deleted ${deleted} physical files from uploads/historical-files`);
      } catch (err) {
        console.warn('Could not delete physical files:', err.message);
      }
    }

    console.log('Historical data deletion complete.');
  } catch (err) {
    console.error('Error deleting historical data:', err);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

deleteHistoricalData();
