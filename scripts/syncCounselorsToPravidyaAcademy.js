/**
 * Backfill AcademyUser for counselors created via Super Admin onboarding
 * so they can log in to the Pravidya Counselor Portal.
 * Run: node scripts/syncCounselorsToPravidyaAcademy.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../prisma/client.js';
import { academySlugForJitofyId } from '../utils/institutionIds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function academySlugForInstitution(jitofyInstitutionId, institutionName) {
  const slug = academySlugForJitofyId(jitofyInstitutionId);
  if (slug) return slug;
  const j = (jitofyInstitutionId || '').trim();
  if (j) return j.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const name = (institutionName || 'academy').trim();
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'academy';
}

async function main() {
  const counselors = await prisma.user.findMany({
    where: { role: 'COUNSELOR', institutionId: { not: null } },
    include: {
      institution: true,
      counselorProfile: true,
    },
  });

  if (counselors.length === 0) {
    console.log('No counselors with institutionId found.');
    return;
  }

  console.log(`Found ${counselors.length} counselor(s) to sync.`);

  for (const user of counselors) {
    const inst = user.institution;
    if (!inst) {
      console.warn(`Counselor ${user.email}: institution not found, skip.`);
      continue;
    }

    let academy = await prisma.academy.findFirst({
      where: { institutionId: inst.id },
    });
    if (!academy) {
      const slug = academySlugForInstitution(inst.jitofyInstitutionId, inst.name);
      academy = await prisma.academy.upsert({
        where: { slug },
        create: { name: inst.name, slug, institutionId: inst.id, domain: 'acme' },
        update: { institutionId: inst.id, name: inst.name },
      });
      console.log(`  Academy for ${inst.name}: ${academy.slug}`);
    }

    const emailNorm = user.email.trim().toLowerCase();
    const fullName = user.counselorProfile?.fullName || user.username || null;

    await prisma.academyUser.upsert({
      where: { academyId_email: { academyId: academy.id, email: emailNorm } },
      update: {
        passwordHash: user.password,
        role: 'COUNSELOR',
        fullName,
      },
      create: {
        academyId: academy.id,
        role: 'COUNSELOR',
        email: emailNorm,
        passwordHash: user.password,
        fullName,
      },
    });

    console.log(`  Synced: ${user.email} -> academy ${academy.slug} (COUNSELOR)`);
  }

  console.log('Done. Counselors can now log in at Pravidya Counselor Portal.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
