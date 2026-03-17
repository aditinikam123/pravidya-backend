/**
 * Creates only the PRAVIDYA Academy (slug: veeman). Use this if you get "Academy not found".
 * Does not touch academy_users. Run from backend: node scripts/seedPravidyaAcademyOnly.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../prismaClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
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
  console.log('Academy created/updated:', academy.name, '| slug:', academy.slug);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
