import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function testConnection() {
  console.log('🔍 Testing database connection...');
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? 
    process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@') : 'NOT SET');
  console.log('');

  try {
    console.log('Attempting to connect...');
    await prisma.$connect();
    console.log('✅ Connection successful!');
    
    console.log('Testing query...');
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Query test successful:', result);
    
    console.log('Checking database tables...');
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    console.log('✅ Found tables:', tables.length);
    tables.forEach((table, idx) => {
      if (idx < 10) console.log(`   - ${table.table_name}`);
    });
    if (tables.length > 10) {
      console.log(`   ... and ${tables.length - 10} more`);
    }
    
  } catch (error) {
    console.error('❌ Connection failed!');
    console.error('Error:', error.message);
    console.error('');
    console.error('Troubleshooting steps:');
    console.error('1. Check if your Neon database is active (not paused)');
    console.error('2. Go to Neon dashboard: https://console.neon.tech');
    console.error('3. Check if the database is paused - if so, click "Resume"');
    console.error('4. Verify your DATABASE_URL in .env file');
    console.error('5. Check if your IP is allowed (Neon allows all IPs by default)');
    console.error('6. Try regenerating the connection string from Neon dashboard');
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
