/**
 * Add Management user without wiping existing data.
 * Run: node scripts/addManagementUser.js
 */
import dotenv from 'dotenv';
import { prisma } from '../prisma/client.js';
import { hashPassword } from '../utils/password.js';

dotenv.config();

const MANAGEMENT_USER = {
  username: 'management',
  email: 'management@admissions.com',
  password: 'management123',
  role: 'MANAGEMENT',
};

async function addManagementUser() {
  try {
    console.log('Adding Management user...\n');

    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { username: MANAGEMENT_USER.username },
          { email: MANAGEMENT_USER.email },
        ],
      },
    });

    if (existing) {
      if (existing.role === 'MANAGEMENT') {
        console.log('✅ Management user already exists:', existing.username);
        console.log('   Login at /management/login');
        console.log('   Username:', MANAGEMENT_USER.username);
        console.log('   Password:', MANAGEMENT_USER.password);
      } else {
        console.log('⚠️  User with username/email exists but has role:', existing.role);
        console.log('   Consider using a different username/email or update the existing user in the database.');
      }
    } else {
      const hashedPassword = await hashPassword(MANAGEMENT_USER.password);
      await prisma.user.create({
        data: {
          username: MANAGEMENT_USER.username,
          email: MANAGEMENT_USER.email,
          password: hashedPassword,
          role: 'MANAGEMENT',
          isActive: true,
        },
      });
      console.log('✅ Management user created successfully!\n');
      console.log('📋 Login credentials:');
      console.log('   Username:', MANAGEMENT_USER.username);
      console.log('   Email:', MANAGEMENT_USER.email);
      console.log('   Password:', MANAGEMENT_USER.password);
      console.log('\n   Login at: /management/login');
    }

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

addManagementUser();
