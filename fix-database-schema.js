// Script to fix database schema - add missing schoolId column
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function fixSchema() {
  try {
    console.log('🔧 Fixing database schema...\n');

    // Check if column exists
    const result = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'counselor_profiles' 
      AND column_name = 'schoolId'
    `;

    if (result.length > 0) {
      console.log('✅ schoolId column already exists in counselor_profiles table');
      return;
    }

    console.log('📝 Adding schoolId column to counselor_profiles table...');

    // Add the column
    await prisma.$executeRaw`
      ALTER TABLE counselor_profiles 
      ADD COLUMN IF NOT EXISTS "schoolId" TEXT
    `;

    console.log('✅ Added schoolId column');

    // Create index
    console.log('📝 Creating index on schoolId...');
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "counselor_profiles_schoolId_idx" 
      ON counselor_profiles("schoolId")
    `;

    console.log('✅ Created index');

    // Add foreign key if School table exists
    try {
      const schoolTableExists = await prisma.$queryRaw`
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'schools'
      `;

      if (schoolTableExists.length > 0) {
        console.log('📝 Adding foreign key constraint...');
        await prisma.$executeRaw`
          ALTER TABLE counselor_profiles
          ADD CONSTRAINT IF NOT EXISTS "counselor_profiles_schoolId_fkey" 
          FOREIGN KEY ("schoolId") 
          REFERENCES schools(id) 
          ON DELETE SET NULL
        `;
        console.log('✅ Added foreign key constraint');
      } else {
        console.log('⚠️  Schools table does not exist yet, skipping foreign key');
      }
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('duplicate')) {
        console.log('ℹ️  Foreign key constraint already exists');
      } else {
        console.log('⚠️  Could not add foreign key:', error.message);
      }
    }

    console.log('\n✅ Database schema fixed successfully!');
    console.log('You can now try counselor login again.');

  } catch (error) {
    console.error('❌ Error fixing schema:', error.message);
    
    if (error.message.includes('Can\'t reach database')) {
      console.error('\n💡 Database connection issue. Please:');
      console.error('1. Check if database is active in Neon dashboard');
      console.error('2. Verify DATABASE_URL in .env file');
      console.error('3. Try running: node test-db-connection.js');
    }
    
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

fixSchema();
