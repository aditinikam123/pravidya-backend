import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const testConnection = async () => {
  const prisma = new PrismaClient({
    log: ['query', 'error', 'warn'],
  });

  try {
    console.log('🔍 Testing database connection...\n');
    console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ Set' : '❌ Not set');
    
    if (process.env.DATABASE_URL) {
      // Mask password in URL for display
      const maskedUrl = process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@');
      console.log('Connection string:', maskedUrl);
    }
    
    console.log('\nAttempting to connect...');
    
    // Try to connect
    await prisma.$connect();
    console.log('✅ Successfully connected to database!');
    
    // Test a simple query
    console.log('\nTesting query...');
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Query test successful:', result);
    
    // Try to get database version
    const version = await prisma.$queryRaw`SELECT version()`;
    console.log('✅ Database version:', version[0]?.version || 'Unknown');
    
    console.log('\n✅ All connection tests passed!');
    
  } catch (error) {
    console.error('\n❌ Connection failed!');
    console.error('Error:', error.message);
    console.error('\n🔧 Troubleshooting steps:');
    console.error('1. Check if your Neon database is paused (log into Neon console to wake it up)');
    console.error('2. Verify your DATABASE_URL is correct in .env file');
    console.error('3. Check your network connection');
    console.error('4. Try removing "channel_binding=require" from DATABASE_URL');
    console.error('5. Ensure your Neon project is active and not deleted');
    
    if (error.message.includes('Can\'t reach database server')) {
      console.error('\n💡 This usually means:');
      console.error('   - Database is paused (most common with Neon)');
      console.error('   - Network/firewall is blocking the connection');
      console.error('   - Database endpoint is incorrect');
    }
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
};

testConnection();
