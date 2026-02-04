// Test Prisma Client Availability
import { prisma } from './prisma/client.js';

console.log('Testing Prisma Client...\n');

// Check if prisma is defined
if (!prisma) {
  console.error('❌ ERROR: prisma is undefined');
  process.exit(1);
}

console.log('✅ prisma is defined');

// Check available models
const models = Object.keys(prisma).filter(key => !key.startsWith('$'));
console.log('\nAvailable Prisma models:', models);

// Check if counselorPresence exists
if (!prisma.counselorPresence) {
  console.error('\n❌ ERROR: prisma.counselorPresence is undefined');
  console.error('Available models:', models);
  console.error('\nPossible fixes:');
  console.error('1. Run: npm run prisma:generate');
  console.error('2. Check schema.prisma for CounselorPresence model');
  process.exit(1);
}

console.log('✅ prisma.counselorPresence is available');

// Test a simple query
try {
  const result = await prisma.counselorPresence.findMany({ take: 1 });
  console.log('✅ Test query successful');
  console.log('Sample result:', result);
} catch (error) {
  console.error('❌ Test query failed:', error.message);
  process.exit(1);
}

console.log('\n✅ All Prisma client tests passed!');
await prisma.$disconnect();
