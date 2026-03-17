import express from 'express';
import nodemailer from 'nodemailer';
import { body, validationResult } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../prismaClient.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { generateToken } from '../utils/jwt.js';

const router = express.Router();

// -----------------------
// Jeetofy license stub (replace with real Jeetofy API integration)
// -----------------------
function daysBetween(now, end) {
  const ms = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function renewalLink(academyId) {
  return `https://pravidya.jeetofy.com/academy/${encodeURIComponent(academyId)}`;
}

async function fetchJeetofyLicense(academyId) {
  const licenseStartDate = new Date();
  const licenseEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return {
    academyId,
    schoolName: 'Veman Academy',
    adminEmail: 'admin@example.com',
    planType: 'TRIAL',
    licenseStartDate: licenseStartDate.toISOString(),
    licenseEndDate: licenseEndDate.toISOString(),
    daysRemaining: daysBetween(new Date(), licenseEndDate),
  };
}

function isExpired(licenseEndDateIso) {
  const d = new Date(licenseEndDateIso);
  return Number.isNaN(d.getTime()) ? true : d <= new Date();
}

// -----------------------
// Email (NodeMailer) for onboarding credentials
// -----------------------
function getMailer() {
  const host = (process.env.EMAIL_HOST || '').trim();
  const port = Number(process.env.EMAIL_PORT || '587');
  const user = (process.env.EMAIL_USER || '').trim();
  const pass = (process.env.EMAIL_PASS || '').trim();
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: Number.isNaN(port) ? 587 : port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
  });
}

async function sendCredentialsEmail({ to, name, username, password }) {
  const mailer = getMailer();
  if (!mailer) return false;
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const loginUrl = 'https://pravidya.jeetofy.com/login';
  await mailer.sendMail({
    from,
    to,
    subject: 'Welcome to Pravidya',
    html: `
      <p>Hello ${name},</p>
      <p>Your Pravidya account has been created.</p>
      <p><strong>Login URL:</strong> ${loginUrl}<br/>
      <strong>Username:</strong> ${username}<br/>
      <strong>Password:</strong> ${password}</p>
      <p>Please login and change your password after first login.</p>
    `,
  });
  return true;
}

// -----------------------
// STEP 1 — GET /api/license/{academyId}
// -----------------------
router.get(
  '/license/:academyId',
  asyncHandler(async (req, res) => {
    const academyId = decodeURIComponent(String(req.params.academyId || '')).trim();
    if (!academyId) return res.status(400).json({ success: false, message: 'academyId is required' });
    const data = await fetchJeetofyLicense(academyId);
    return res.json({ success: true, data });
  })
);

// -----------------------
// STEP 2-6,10-13 — POST /api/onboarding/:academyId
// Only extends onboarding; uses Institution + User tables (no dashboard changes)
// -----------------------
router.post(
  '/onboarding/:academyId',
  [
    // School setup (read-only fields come from license, but validate anyway)
    body('schoolAddress').trim().notEmpty().withMessage('School Address is required'),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('state').trim().notEmpty().withMessage('State is required'),
    body('pincode').trim().notEmpty().withMessage('Pincode is required'),
    body('contactNumber').trim().notEmpty().withMessage('School Contact Number is required'),
    body('website').optional().trim(),
    body('logoUrl').optional().trim(),

    // Admin
    body('adminPassword').isLength({ min: 6 }).withMessage('Admin password must be at least 6 characters'),

    // Primary counselor (match required subset; remaining fields use safe defaults)
    body('counselorName').trim().notEmpty(),
    body('counselorEmail').isEmail().normalizeEmail(),
    body('counselorUsername').trim().notEmpty(),
    body('counselorPhone').optional().trim(),
    body('counselorPassword').isLength({ min: 6 }),

    // Management
    body('managementName').trim().notEmpty(),
    body('managementEmail').isEmail().normalizeEmail(),
    body('managementUsername').trim().notEmpty(),
    body('managementPassword').isLength({ min: 6 }),
  ],
  asyncHandler(async (req, res) => {
    const academyId = decodeURIComponent(String(req.params.academyId || '')).trim();
    if (!academyId) return res.status(400).json({ success: false, message: 'academyId is required' });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const license = await fetchJeetofyLicense(academyId);
    if (isExpired(license.licenseEndDate)) {
      return res.status(402).json({
        success: false,
        message: 'License expired',
        data: { renewalLink: renewalLink(academyId) },
      });
    }

    const schoolName = String(license.schoolName || '').trim();
    const adminEmail = String(license.adminEmail || '').trim().toLowerCase();

    const {
      logoUrl,
      schoolAddress,
      city,
      state,
      pincode,
      contactNumber,
      website,
      adminPassword,
      counselorName,
      counselorEmail,
      counselorUsername,
      counselorPhone,
      counselorPassword,
      managementName,
      managementEmail,
      managementUsername,
      managementPassword,
    } = req.body;

    // STEP 2 — Save school profile linked with academyId
    // We store in Institution keyed by jitofyInstitutionId, plus extra fields in customData.
    // IMPORTANT: some legacy rows may have an invalid enum value in institutions.type (e.g. "Academy").
    // Avoid selecting the enum field during read/update responses to prevent Prisma decode errors.
    let institution = await prisma.institution.findFirst({
      where: { jitofyInstitutionId: academyId },
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        state: true,
        logoUrl: true,
        customData: true,
      },
    });
    if (!institution) {
      const existsByName = await prisma.institution.findFirst({ where: { name: schoolName } });
      const uniqueName = existsByName ? `${schoolName} (${academyId})` : schoolName;
      institution = await prisma.institution.create({
        data: {
          jitofyInstitutionId: academyId,
          name: uniqueName,
          type: 'School',
          address: schoolAddress.trim(),
          city: city.trim(),
          state: state.trim(),
          logoUrl: logoUrl?.trim?.() || null,
          isActive: true,
          customData: {
            pincode: String(pincode).trim(),
            contactNumber: String(contactNumber).trim(),
            website: website?.trim?.() || null,
            onboardedAt: new Date().toISOString(),
            planType: license.planType,
            licenseStartDate: license.licenseStartDate,
            licenseEndDate: license.licenseEndDate,
          },
        },
        select: { id: true },
      });
    } else {
      institution = await prisma.institution.update({
        where: { id: institution.id },
        data: {
          // Force valid enum value if legacy row had invalid value
          type: 'School',
          address: schoolAddress.trim(),
          city: city.trim(),
          state: state.trim(),
          logoUrl: logoUrl?.trim?.() || institution.logoUrl,
          customData: {
            ...(institution.customData || {}),
            pincode: String(pincode).trim(),
            contactNumber: String(contactNumber).trim(),
            website: website?.trim?.() || null,
            onboardedAt: new Date().toISOString(),
            planType: license.planType,
            licenseStartDate: license.licenseStartDate,
            licenseEndDate: license.licenseEndDate,
          },
        },
        select: { id: true, customData: true, logoUrl: true, address: true, city: true, state: true },
      });
    }

    // STEP 12 — Unique username/email
    const counselorEmailNorm = String(counselorEmail).trim().toLowerCase();
    const managementEmailNorm = String(managementEmail).trim().toLowerCase();
    const adminUsername = adminEmail; // username-or-email login supports this

    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email: adminEmail },
          { username: adminUsername },
          { email: counselorEmailNorm },
          { username: counselorUsername.trim() },
          { email: managementEmailNorm },
          { username: managementUsername.trim() },
        ],
      },
      select: { id: true },
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Unique constraint: username or email already exists' });
    }

    // STEP 3/4/5 — Create users linked with academyId (via institutionId relation)
    const [adminHash, counselorHash, managementHash] = await Promise.all([
      hashPassword(String(adminPassword)),
      hashPassword(String(counselorPassword)),
      hashPassword(String(managementPassword)),
    ]);

    // First, create core app users + counselor profile in a short transaction
    await prisma.$transaction(async (tx) => {
      // Admin
      await tx.user.create({
        data: {
          username: adminUsername,
          email: adminEmail,
          password: adminHash,
          role: 'ADMIN',
          institutionId: institution.id,
          isActive: true,
        },
      });

      // Counselor (role name used by dashboards is COUNSELOR)
      const counselor = await tx.user.create({
        data: {
          username: counselorUsername.trim(),
          email: counselorEmailNorm,
          password: counselorHash,
          role: 'COUNSELOR',
          institutionId: institution.id,
          isActive: true,
        },
      });

      await tx.counselorProfile.create({
        data: {
          userId: counselor.id,
          fullName: counselorName.trim(),
          mobile: (counselorPhone || '').trim() || 'NA',
          expertise: [],
          languages: [],
        },
      });

      // Management
      await tx.user.create({
        data: {
          username: managementUsername.trim(),
          email: managementEmailNorm,
          password: managementHash,
          role: 'MANAGEMENT',
          institutionId: institution.id,
          isActive: true,
        },
      });
    });

    // Then, outside the transaction (to avoid long interactive tx), wire up Academy + AcademyUsers for OTP login
    const academy = await prisma.academy.upsert({
      where: { slug: 'veeman' },
      update: {},
      create: {
        name: 'Veman Academy',
        slug: 'veeman',
        domain: 'acme',
        logoUrl: null,
      },
    });

    // Admin AcademyUser
    await prisma.academyUser.upsert({
      where: {
        academyId_email: {
          academyId: academy.id,
          email: adminEmail,
        },
      },
      update: {
        role: 'ADMIN',
        passwordHash: adminHash,
        passwordLastChanged: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      },
      create: {
        academyId: academy.id,
        role: 'ADMIN',
        email: adminEmail,
        passwordHash: adminHash,
      },
    });

    // Counselor AcademyUser
    await prisma.academyUser.upsert({
      where: {
        academyId_email: {
          academyId: academy.id,
          email: counselorEmailNorm,
        },
      },
      update: {
        role: 'COUNSELOR',
        passwordHash: counselorHash,
        passwordLastChanged: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      },
      create: {
        academyId: academy.id,
        role: 'COUNSELOR',
        email: counselorEmailNorm,
        passwordHash: counselorHash,
        fullName: counselorName.trim(),
      },
    });

    // Management AcademyUser
    await prisma.academyUser.upsert({
      where: {
        academyId_email: {
          academyId: academy.id,
          email: managementEmailNorm,
        },
      },
      update: {
        role: 'MANAGEMENT',
        passwordHash: managementHash,
        passwordLastChanged: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      },
      create: {
        academyId: academy.id,
        role: 'MANAGEMENT',
        email: managementEmailNorm,
        passwordHash: managementHash,
        fullName: managementName.trim(),
      },
    });

    // STEP 6/9 — Send credentials emails (best-effort)
    try {
      await Promise.all([
        sendCredentialsEmail({
          to: counselorEmailNorm,
          name: counselorName.trim(),
          username: counselorUsername.trim(),
          password: String(counselorPassword),
        }),
        sendCredentialsEmail({
          to: managementEmailNorm,
          name: managementName.trim(),
          username: managementUsername.trim(),
          password: String(managementPassword),
        }),
      ]);
    } catch (e) {
      // Do not fail onboarding on SMTP issues
      console.warn('[Jeetofy onboarding] email send failed:', e?.message || e);
    }

    return res.status(201).json({
      success: true,
      message: 'Onboarding Completed Successfully.',
      data: {
        academyId,
        institutionId: institution.id,
      },
    });
  })
);

// -----------------------
// STEP 8/10 — POST /api/login
// New login for Jeetofy SaaS users (does not change dashboard auth endpoints)
// -----------------------
router.post(
  '/login',
  [body('username').trim().notEmpty(), body('password').notEmpty()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { username, password } = req.body;
    const user = await prisma.user.findFirst({
      where: { OR: [{ username }, { email: username }] },
      include: { institution: true, counselorProfile: true },
    });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    if (!user.isActive) return res.status(401).json({ success: false, message: 'Account is inactive' });

    const ok = await comparePassword(password, user.password);
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const academyId = user.institution?.jitofyInstitutionId;
    if (academyId) {
      const license = await fetchJeetofyLicense(academyId);
      if (isExpired(license.licenseEndDate)) {
        return res.status(402).json({
          success: false,
          message: 'License expired',
          data: { renewalLink: renewalLink(academyId) },
        });
      }
    }

    const token = generateToken(user.id, user.role);
    const { password: _, ...userWithoutPassword } = user;
    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          ...userWithoutPassword,
          isAdmin: user.role === 'ADMIN',
          isCounselor: user.role === 'COUNSELOR',
          isManagement: user.role === 'MANAGEMENT',
        },
      },
    });
  })
);

export default router;

