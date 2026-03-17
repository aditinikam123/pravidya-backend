/**
 * Seed PRAVIDYA Academy - creates Academy and AcademyUsers.
 * Each counselor has their own email, password, and display name (fullName).
 * Run: node scripts/seedPravidyaAcademy.js
 *
 * .env (optional): PRAVIDYA_ADMIN_EMAIL, PRAVIDYA_ADMIN_PASSWORD, PRAVIDYA_MANAGEMENT_EMAIL, PRAVIDYA_PASSWORD
 *       PRAVIDYA_COUNSELOR1_EMAIL, PRAVIDYA_COUNSELOR1_PASSWORD, PRAVIDYA_COUNSELOR1_NAME
 *       PRAVIDYA_COUNSELOR2_EMAIL, PRAVIDYA_COUNSELOR2_PASSWORD, PRAVIDYA_COUNSELOR2_NAME
 *       PRAVIDYA_COUNSELOR3_EMAIL, PRAVIDYA_COUNSELOR3_PASSWORD, PRAVIDYA_COUNSELOR3_NAME
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../prismaClient.js';
import { hashPassword } from '../utils/password.js';

// Load backend/.env so seed works even when server is started from another directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const ADMIN_EMAIL = (process.env.PRAVIDYA_ADMIN_EMAIL || 'aditinikam0123@gmail.com').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.PRAVIDYA_ADMIN_PASSWORD || 'aditi@123';
const MANAGEMENT_EMAIL = (process.env.PRAVIDYA_MANAGEMENT_EMAIL || 'management@vemanacademy.com').trim().toLowerCase();
const SEED_PASSWORD = process.env.PRAVIDYA_PASSWORD || 'Pravidya@123';

// Each counselor: unique email, password, and fullName (login uses email + password)
const COUNSELORS = [
  { email: (process.env.PRAVIDYA_COUNSELOR1_EMAIL || 'shrutibalekundri7@gmail.com').trim().toLowerCase(), password: process.env.PRAVIDYA_COUNSELOR1_PASSWORD || 'shruti@123', fullName: (process.env.PRAVIDYA_COUNSELOR1_NAME || 'Rakesh Kumar').trim() },
  { email: (process.env.PRAVIDYA_COUNSELOR2_EMAIL || 'counselor2@vemanacademy.com').trim().toLowerCase(), password: process.env.PRAVIDYA_COUNSELOR2_PASSWORD || 'Counselor2@123', fullName: (process.env.PRAVIDYA_COUNSELOR2_NAME || 'Counselor 2').trim() },
  { email: (process.env.PRAVIDYA_COUNSELOR3_EMAIL || 'counselor3@vemanacademy.com').trim().toLowerCase(), password: process.env.PRAVIDYA_COUNSELOR3_PASSWORD || 'Counselor3@123', fullName: (process.env.PRAVIDYA_COUNSELOR3_NAME || 'Counselor 3').trim() },
];

export async function runPravidyaSeed() {
  const academy = await prisma.academy.upsert({
    where: { slug: 'veeman' },
    update: { logoUrl: '/logo-veman-academy.png' },
    create: {
      name: 'Veman Academy',
      slug: 'veeman',
      domain: 'acme',
      description: 'Quality education for your child. Expert faculty, modern curriculum, and a nurturing environment for academic excellence.',
      contactEmail: 'contact@vemanacademy.com',
      contactPhone: '+91 98765 43210',
      logoUrl: '/logo-veman-academy.png',
    },
  });

  console.log('Academy:', academy.name, academy.slug);

  const adminHash = await hashPassword(ADMIN_PASSWORD);
  const mgmtHash = await hashPassword(SEED_PASSWORD);
  const counselorHashes = await Promise.all(COUNSELORS.map((c) => hashPassword(c.password)));
  const now = new Date();
  const baseUpdate = { passwordLastChanged: now, failedAttempts: 0, lockedUntil: null };

  const adminUpsert = prisma.academyUser.upsert({
    where: { academyId_email: { academyId: academy.id, email: ADMIN_EMAIL } },
    update: { ...baseUpdate, passwordHash: adminHash, role: 'ADMIN' },
    create: {
      academyId: academy.id,
      role: 'ADMIN',
      email: ADMIN_EMAIL,
      passwordHash: adminHash,
    },
  });

  const mgmtUpsert = prisma.academyUser.upsert({
    where: { academyId_email: { academyId: academy.id, email: MANAGEMENT_EMAIL } },
    update: { ...baseUpdate, passwordHash: mgmtHash, role: 'MANAGEMENT' },
    create: {
      academyId: academy.id,
      role: 'MANAGEMENT',
      email: MANAGEMENT_EMAIL,
      passwordHash: mgmtHash,
    },
  });

  const counselorUpserts = COUNSELORS.map((c, i) =>
    prisma.academyUser.upsert({
      where: { academyId_email: { academyId: academy.id, email: c.email } },
      update: { ...baseUpdate, passwordHash: counselorHashes[i], role: 'COUNSELOR', fullName: c.fullName || null },
      create: {
        academyId: academy.id,
        role: 'COUNSELOR',
        email: c.email,
        passwordHash: counselorHashes[i],
        fullName: c.fullName || null,
      },
    })
  );

  await Promise.all([adminUpsert, mgmtUpsert, ...counselorUpserts]);

  console.log('PRAVIDYA seeded.');
  console.log('Login: http://localhost:3000/pravidya/acme/veeman/login');
  console.log('Admin:', ADMIN_EMAIL, '(password:', ADMIN_PASSWORD + ')', '| Management:', MANAGEMENT_EMAIL, '(password:', SEED_PASSWORD + ')');
  COUNSELORS.forEach((c, i) => console.log('Counselor' + (i + 1) + ':', c.fullName || c.email, '|', c.email, '(password:', c.password + ')'));
}

// Run when executed directly (node scripts/seedPravidyaAcademy.js)
const isMain = process.argv[1]?.endsWith('seedPravidyaAcademy.js');
if (isMain) {
  runPravidyaSeed()
    .then(() => console.log('Done.'))
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
