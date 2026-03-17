import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../prismaClient.js';
import { hashPassword } from '../utils/password.js';

const router = express.Router();

const JWT_SECRET = process.env.SAAS_JWT_SECRET || process.env.JWT_SECRET || 'dev-saas-secret';

// In-memory state (no DB changes required)
const saasAcademies = new Map(); // academyId -> { academyId, schoolName, licenseExpiry, address, logoUrl }
const saasUsers = new Map(); // academyId -> { email, passwordHash, role }

function signSaasToken(user) {
  return jwt.sign(
    { sub: user.email, academyId: user.academyId, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
}

// Stubbed Jeetofy license lookup – always returns a valid license for demo
async function fetchJeetofyLicense(academyId) {
  const daysRemaining = 30;
  const licenseExpiry = new Date(Date.now() + daysRemaining * 24 * 60 * 60 * 1000);

  return {
    academyId,
    schoolName: 'Veman Academy',
    adminEmail: 'admin@example.com',
    daysRemaining,
    renewalLink: `https://pravidya.jeetofy.com/${encodeURIComponent(academyId)}/renew`,
    licenseExpiry,
  };
}

// License/auth middleware for SaaS dashboard APIs (uses in-memory academies map)
async function saasLicenseAuth(req, res, next) {
  try {
    const token = req.cookies?.saas_token;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.saasUser = payload;

    const academy = saasAcademies.get(payload.academyId);
    if (!academy) {
      return res.status(404).json({ success: false, message: 'Academy not found' });
    }

    const now = new Date();
    if (academy.licenseExpiry <= now) {
      return res.status(402).json({
        success: false,
        message: 'License expired',
        code: 'LICENSE_EXPIRED',
      });
    }

    req.saasAcademy = academy;
    next();
  } catch (err) {
    console.error('SAAS auth error:', err);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// GET /api/saas/license/:academyId  (academyId may contain hyphens, e.g. PRV-F-000018)
router.get('/license/:academyId', async (req, res) => {
  const academyId = decodeURIComponent(req.params.academyId || '').trim() || req.params.academyId;
  try {
    const license = await fetchJeetofyLicense(academyId);
    if (!license) {
      return res.status(404).json({ success: false, message: 'License not found' });
    }

    const {
      schoolName,
      adminEmail,
      daysRemaining,
      renewalLink,
      licenseExpiry,
    } = license;

    saasAcademies.set(academyId, {
      academyId,
      schoolName,
      licenseExpiry,
      logoUrl: null,
      address: null,
    });

    return res.json({
      success: true,
      data: {
        academyId,
        schoolName,
        adminEmail,
        daysRemaining,
        renewalLink,
      },
    });
  } catch (err) {
    console.error('SAAS license error:', err);
    return res.status(500).json({ success: false, message: 'License lookup failed' });
  }
});

// GET /api/saas/admin-exists/:academyId
router.get('/admin-exists/:academyId', async (req, res) => {
  const academyId = decodeURIComponent(req.params.academyId || '').trim() || req.params.academyId;
  const user = saasUsers.get(academyId);
  const adminExists = !!user && user.role === 'ADMIN';

  return res.json({
    success: true,
    data: { adminExists },
  });
});

// POST /api/saas/onboard
router.post('/onboard', async (req, res) => {
  try {
    const { academyId, password, address, logoUrl } = req.body;
    if (!academyId || !password) {
      return res
        .status(400)
        .json({ success: false, message: 'academyId and password are required' });
    }

    const academy = saasAcademies.get(academyId);
    if (!academy) {
      return res.status(404).json({ success: false, message: 'Academy not found' });
    }

    const existing = saasUsers.get(academyId);
    if (existing && existing.role === 'ADMIN') {
      return res.status(400).json({ success: false, message: 'Admin already exists' });
    }

    const license = await fetchJeetofyLicense(academyId);
    const adminEmail = license?.adminEmail?.toLowerCase();
    if (!adminEmail) {
      return res.status(400).json({ success: false, message: 'Admin email missing in license' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = {
      academyId,
      email: adminEmail,
      passwordHash: hashed,
      role: 'ADMIN',
    };

    saasUsers.set(academyId, user);
    saasAcademies.set(academyId, {
      ...academy,
      address: address || null,
      logoUrl: logoUrl || academy.logoUrl,
    });

    const token = signSaasToken(user);

    return res
      .cookie('saas_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      })
      .json({ success: true, message: 'Onboarding complete' });
  } catch (err) {
    console.error('SAAS onboard error:', err);
    return res.status(500).json({ success: false, message: 'Onboarding failed' });
  }
});

// POST /api/saas/login
router.post('/login', async (req, res) => {
  try {
    const { academyId, email, password } = req.body;
    if (!academyId || !email || !password) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    const user = saasUsers.get(academyId);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.email !== email.toLowerCase()) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = signSaasToken(user);

    return res
      .cookie('saas_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      })
      .json({ success: true, message: 'Login successful' });
  } catch (err) {
    console.error('SAAS login error:', err);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// GET /api/saas/dashboard
router.get('/dashboard', saasLicenseAuth, async (req, res) => {
  const academy = req.saasAcademy;
  return res.json({
    success: true,
    data: {
      academy: {
        academyId: academy.academyId,
        schoolName: academy.schoolName,
        logoUrl: academy.logoUrl,
        licenseExpiry: academy.licenseExpiry,
        address: academy.address,
      },
    },
  });
});

// GET /api/saas/pravidya/status
// Check whether this Jeetofy academyId (jitofyInstitutionId) is onboarded in Pravidya DB.
router.get('/pravidya/status', saasLicenseAuth, async (req, res) => {
  const academyId = req.saasUser?.academyId;
  // For now, this Jeetofy flow is wired to the Pravidya academy slug "veeman".
  // "Onboarded" means: the academy exists AND has at least one ADMIN academy user.
  const academy = await prisma.academy.findUnique({
    where: { slug: 'veeman' },
    select: { id: true, name: true, slug: true, logoUrl: true, contactEmail: true, contactPhone: true },
  });
  // IMPORTANT: Don't mark as onboarded just because seed created *some* admin.
  // For Jeetofy onboarding, we consider it onboarded when the Jeetofy admin email exists as ADMIN.
  const lic = academyId ? await fetchJeetofyLicense(academyId) : null;
  const jeetofyAdminEmail = lic?.adminEmail?.toLowerCase?.().trim?.() || null;
  const adminUser = academy && jeetofyAdminEmail
    ? await prisma.academyUser.findFirst({
        where: { academyId: academy.id, role: 'ADMIN', email: jeetofyAdminEmail },
        select: { id: true, email: true, role: true },
      })
    : null;

  return res.json({
    success: true,
    data: {
      academyId,
      onboarded: !!academy && !!adminUser,
      academy,
      adminUser,
      jeetofyAdminEmail,
    },
  });
});

// POST /api/saas/pravidya/onboard
// First-time onboarding for a Jeetofy institution into Pravidya (no Super Admin required).
router.post('/pravidya/onboard', saasLicenseAuth, async (req, res) => {
  const academyId = req.saasUser?.academyId;
  const {
    name,
    type = 'School',
    address,
    city,
    state,
    logoUrl,
    contactEmail,
    contactPhone,
    adminUsername,
    adminEmail,
    adminPassword,
  } = req.body || {};

  if (!academyId) return res.status(400).json({ success: false, message: 'Missing academy context' });
  if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: 'School name is required' });
  if (!adminUsername || !String(adminUsername).trim()) return res.status(400).json({ success: false, message: 'Admin username is required' });
  if (!adminEmail || !String(adminEmail).trim()) return res.status(400).json({ success: false, message: 'Admin email is required' });
  if (!adminPassword || String(adminPassword).length < 6) return res.status(400).json({ success: false, message: 'Admin password must be at least 6 characters' });

  const nameTrimmed = String(name).trim();
  const adminEmailTrimmed = String(adminEmail).trim().toLowerCase();

  // Upsert Pravidya academy (slug veeman) with onboarded details
  const academy = await prisma.academy.upsert({
    where: { slug: 'veeman' },
    update: {
      name: nameTrimmed,
      logoUrl: logoUrl?.trim?.() || null,
      contactEmail: contactEmail?.trim?.() || null,
      contactPhone: contactPhone?.trim?.() || null,
      // Keep description as-is if already set elsewhere
    },
    create: {
      name: nameTrimmed,
      slug: 'veeman',
      domain: 'acme',
      logoUrl: logoUrl?.trim?.() || null,
      contactEmail: contactEmail?.trim?.() || null,
      contactPhone: contactPhone?.trim?.() || null,
      description: 'Onboarded via Jeetofy',
    },
    select: { id: true, name: true, slug: true },
  });

  // Create or update Pravidya AcademyUser (this is what /pravidya/.../login checks)
  const hashed = await hashPassword(String(adminPassword));
  const admin = await prisma.academyUser.upsert({
    where: { academyId_email: { academyId: academy.id, email: adminEmailTrimmed } },
    update: {
      role: 'ADMIN',
      passwordHash: hashed,
      passwordLastChanged: new Date(),
      failedAttempts: 0,
      lockedUntil: null,
    },
    create: {
      academyId: academy.id,
      role: 'ADMIN',
      email: adminEmailTrimmed,
      passwordHash: hashed,
    },
    select: { id: true, email: true, role: true },
  });

  return res.status(201).json({
    success: true,
    message: 'Onboarding complete',
    data: { academyId, academy, adminUser: admin },
  });
});

export default router;

