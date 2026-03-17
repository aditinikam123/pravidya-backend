import express from 'express';
import { body, validationResult } from 'express-validator';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { prisma } from '../../prisma/client.js';
import { comparePassword } from '../../utils/password.js';
import { generateSuperAdminToken } from '../../utils/superAdminJwt.js';
import { hashPassword } from '../../utils/password.js';
import {
  VEMAN_JITOFY_INSTITUTION_ID,
  LEGACY_PLATFORM_JITOFY_ID,
} from '../../utils/institutionIds.js';

const router = express.Router();

// @route   POST /api/super-admin/auth/login
// @desc    Super Admin login - Institution ID + Email + Password
// @access  Public
router.post(
  '/login',
  [
    body('institutionId').trim().notEmpty().withMessage('Institution ID is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { institutionId, email, password } = req.body;
    const instIdNorm = String(institutionId).trim();
    const instIdUpper = instIdNorm.toUpperCase();
    const emailNorm = email.toLowerCase().trim();

    // Find institution by jitofyInstitutionId (case-insensitive; or by id for backward compat)
    let institution = await prisma.institution.findFirst({
      where: {
        OR: [
          { jitofyInstitutionId: instIdNorm },
          { jitofyInstitutionId: instIdUpper },
          ...(instIdNorm.length >= 20 ? [{ id: instIdNorm }] : []),
        ],
      },
    });

    // PRV-F-000018 and PLATFORM are aliases for the same Veman Academy / platform institution
    if (!institution) {
      const vemanUpper = VEMAN_JITOFY_INSTITUTION_ID.toUpperCase();
      if (instIdUpper === vemanUpper) {
        institution = await prisma.institution.findFirst({
          where: { jitofyInstitutionId: LEGACY_PLATFORM_JITOFY_ID },
        });
      } else if (instIdUpper === LEGACY_PLATFORM_JITOFY_ID) {
        institution = await prisma.institution.findFirst({
          where: { jitofyInstitutionId: VEMAN_JITOFY_INSTITUTION_ID },
        });
      }
    }

    if (!institution) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Institution ID or credentials.',
      });
    }

    const superAdmin = await prisma.superAdmin.findUnique({
      where: {
        institutionId_email: { institutionId: institution.id, email: emailNorm },
      },
      include: { institution: true },
    });

    if (!superAdmin || !superAdmin.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Institution ID or credentials.',
      });
    }

    const isValid = await comparePassword(password, superAdmin.passwordHash);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Institution ID or credentials.',
      });
    }

    const token = generateSuperAdminToken(superAdmin.id, superAdmin.institutionId);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: superAdmin.id,
          email: superAdmin.email,
          fullName: superAdmin.fullName ?? undefined,
          role: 'SUPER_ADMIN',
          institutionId: superAdmin.institutionId,
          institutionName: superAdmin.institution?.name,
          jitofyInstitutionId: superAdmin.institution?.jitofyInstitutionId,
        },
      },
    });
  })
);

// @route   POST /api/super-admin/auth/seed-platform
// @desc    Seed Platform institution and first Super Admin (dev/bootstrap only)
// @access  Public (restrict in production via env)
router.post(
  '/seed-platform',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Seed disabled in production' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email, password } = req.body;
    const emailNorm = email.toLowerCase().trim();

    let platform = await prisma.institution.findFirst({
      where: { jitofyInstitutionId: VEMAN_JITOFY_INSTITUTION_ID },
    });
    if (!platform) {
      platform = await prisma.institution.findFirst({
        where: { jitofyInstitutionId: LEGACY_PLATFORM_JITOFY_ID },
      });
    }

    if (!platform) {
      platform = await prisma.institution.create({
        data: {
          name: 'Veman Academy',
          jitofyInstitutionId: VEMAN_JITOFY_INSTITUTION_ID,
          type: 'School',
          isActive: true,
        },
      });
    }

    const existing = await prisma.superAdmin.findUnique({
      where: { institutionId_email: { institutionId: platform.id, email: emailNorm } },
    });

    if (existing) {
      const newHash = await hashPassword(password);
      await prisma.superAdmin.update({
        where: { id: existing.id },
        data: { passwordHash: newHash, isActive: true },
      });
      return res.json({
        success: true,
        message: `Platform Super Admin password updated. Use Institution ID: ${VEMAN_JITOFY_INSTITUTION_ID} (Veman Academy) to login.`,
      });
    }

    const hashed = await hashPassword(password);
    await prisma.superAdmin.create({
      data: {
        institutionId: platform.id,
        email: emailNorm,
        passwordHash: hashed,
        fullName: 'Platform Super Admin',
        isActive: true,
      },
    });

    res.status(201).json({
      success: true,
      message: `Platform Super Admin created. Use Institution ID: ${VEMAN_JITOFY_INSTITUTION_ID} (Veman Academy) to login.`,
    });
  })
);

export default router;
