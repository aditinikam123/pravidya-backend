#!/usr/bin/env node
/**
 * Seed Platform institution (Veman Academy) and first Super Admin.
 * Institution ID: PRV-F-000018 (canonical for Veman Academy; legacy PLATFORM still accepted at login).
 * Run: node scripts/seedSuperAdmin.js
 * Or use API: POST /api/super-admin/auth/seed-platform with { email, password }
 */
import dotenv from 'dotenv';
import { prisma } from '../prisma/client.js';
import { hashPassword } from '../utils/password.js';
import {
  VEMAN_JITOFY_INSTITUTION_ID,
  LEGACY_PLATFORM_JITOFY_ID,
} from '../utils/institutionIds.js';

dotenv.config();

const DEFAULT_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'superadmin@pravidya.local';
const DEFAULT_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';

async function seed() {
  console.log('Seeding Super Admin (Veman Academy)...');

  // Prefer PRV-F-000018; migrate existing PLATFORM row to canonical ID
  let platform = await prisma.institution.findFirst({
    where: { jitofyInstitutionId: VEMAN_JITOFY_INSTITUTION_ID },
  });

  if (!platform) {
    const legacy = await prisma.institution.findFirst({
      where: { jitofyInstitutionId: LEGACY_PLATFORM_JITOFY_ID },
    });
    if (legacy) {
      // Only change jitofy ID; name may already be unique elsewhere as "Veman Academy"
      platform = await prisma.institution.update({
        where: { id: legacy.id },
        data: { jitofyInstitutionId: VEMAN_JITOFY_INSTITUTION_ID },
      });
      console.log('Migrated institution PLATFORM -> PRV-F-000018');
    }
  }

  if (!platform) {
    // Name must be unique; use distinct name if Veman Academy already exists as another row
    const existingName = await prisma.institution.findFirst({
      where: { name: 'Veman Academy' },
    });
    const instName = existingName ? 'Veman Academy (Platform)' : 'Veman Academy';
    platform = await prisma.institution.create({
      data: {
        name: instName,
        jitofyInstitutionId: VEMAN_JITOFY_INSTITUTION_ID,
        type: 'School',
        isActive: true,
      },
    });
    console.log('Created Veman Academy institution (PRV-F-000018)');
  } else {
    console.log('Veman Academy institution already exists');
  }

  const emailNorm = DEFAULT_EMAIL.toLowerCase().trim();
  const existing = await prisma.superAdmin.findUnique({
    where: { institutionId_email: { institutionId: platform.id, email: emailNorm } },
  });

  const hashed = await hashPassword(DEFAULT_PASSWORD);

  if (existing) {
    await prisma.superAdmin.update({
      where: { id: existing.id },
      data: { passwordHash: hashed, isActive: true },
    });
    console.log('Updated Super Admin password');
  } else {
    await prisma.superAdmin.create({
      data: {
        institutionId: platform.id,
        email: emailNorm,
        passwordHash: hashed,
        fullName: 'Platform Super Admin',
        isActive: true,
      },
    });
    console.log('Created Super Admin');
  }

  console.log('\n--- Super Admin Login ---');
  console.log('Institution ID:', VEMAN_JITOFY_INSTITUTION_ID, '(Veman Academy)');
  console.log('Legacy ID still works:', LEGACY_PLATFORM_JITOFY_ID);
  console.log('Email:', DEFAULT_EMAIL);
  console.log('Password:', DEFAULT_PASSWORD);
  console.log('\nLogin at: /super-admin/login');
  console.log('Venam URL: /venam/' + VEMAN_JITOFY_INSTITUTION_ID);
}

seed()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
