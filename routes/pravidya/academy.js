import express from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { prisma } from '../../prismaClient.js';

const router = express.Router();

/** Default academy used when DB has no row (e.g. fresh DB or seed failed). */
const DEFAULT_ACADEMY = {
  name: 'Veman Academy',
  slug: 'veeman',
  domain: 'acme',
  description: 'Quality education for your child. Expert faculty, modern curriculum, and a nurturing environment for academic excellence.',
  contactEmail: 'contact@vemanacademy.com',
  contactPhone: '+91 98765 43210',
  logoUrl: '/logo-veman-academy.png',
};

/** Slug alias: "veman" (one e) in URL maps to DB slug "veeman" (two e's). */
const SLUG_ALIAS = { veman: 'veeman' };

/**
 * GET /api/academy/:slug
 * Fetch academy by slug (public). If slug is 'veeman' or 'veman' and missing, create it.
 */
router.get('/:slug', asyncHandler(async (req, res) => {
  const slug = req.params.slug?.toLowerCase().trim();
  const lookupSlug = SLUG_ALIAS[slug] || slug;
  let academy = await prisma.academy.findUnique({
    where: { slug: lookupSlug },
  });

  if (!academy && (lookupSlug === 'veeman' || slug === 'veman')) {
    academy = await prisma.academy.upsert({
      where: { slug: 'veeman' },
      update: { logoUrl: DEFAULT_ACADEMY.logoUrl },
      create: DEFAULT_ACADEMY,
    });
  }

  if (!academy) {
    return res.status(404).json({
      success: false,
      message: 'Academy not found',
    });
  }

  const { id, name, slug: s, logoUrl, description, contactEmail, contactPhone, domain } = academy;
  res.json({
    success: true,
    data: {
      academy: {
        id,
        name,
        slug: s,
        logoUrl,
        description,
        contactEmail,
        contactPhone,
        domain,
      },
    },
  });
}));

export default router;
