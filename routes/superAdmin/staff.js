import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { prisma } from '../../prisma/client.js';
import { hashPassword } from '../../utils/password.js';
import { getFormFieldSettings } from '../admin.js';
import { isPlatformScope, academySlugForJitofyId } from '../../utils/institutionIds.js';

const router = express.Router();

const isPlatformSuperAdmin = (req) => isPlatformScope(req.superAdmin?.institution);

// Resolve institutionId: Platform must pass it; Institution SA uses own
function resolveInstitutionId(req) {
  if (isPlatformSuperAdmin(req)) {
    return req.body.institutionId || req.query.institutionId;
  }
  return req.institutionId;
}

function academySlugForInstitution(jitofyInstitutionId, institutionName) {
  const slug = academySlugForJitofyId(jitofyInstitutionId);
  if (slug) return slug;
  const j = (jitofyInstitutionId || '').trim();
  if (j) return j.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const name = (institutionName || 'academy').trim();
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'academy';
}

// Resolve academy for an institution by slug (no institutionId on Academy in schema)
async function getAcademyForInstitution(inst) {
  if (!inst) return null;
  const slug = academySlugForInstitution(inst.jitofyInstitutionId, inst.name);
  return prisma.academy.upsert({
    where: { slug },
    create: { name: inst.name, slug, domain: 'acme' },
    update: { name: inst.name },
  });
}

// @route   GET /api/super-admin/staff/settings
// @desc    Get form field settings (counselorFields, etc.) for dynamic forms
// @access  Private (Super Admin)
router.get('/settings', asyncHandler(async (req, res) => {
  const data = await getFormFieldSettings();
  res.json({
    success: true,
    data: {
      counselorFields: data.counselorFields,
      // Admin/Management use same base fields
    },
  });
}));

// @route   GET /api/super-admin/staff
// @desc    List staff (Admin, Counselor, Management) for institution
// @access  Private (Super Admin)
router.get('/', [
  query('institutionId').optional().trim(),
  query('role').optional().isIn(['ADMIN', 'COUNSELOR', 'MANAGEMENT']),
  query('search').optional().trim(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
], asyncHandler(async (req, res) => {
  const instId = resolveInstitutionId(req);
  // Platform can omit institutionId to list all staff; Institution SA must have instId
  if (!instId && !isPlatformSuperAdmin(req)) {
    return res.status(400).json({
      success: false,
      message: 'Institution ID is required',
    });
  }

  const where = instId ? { institutionId: instId } : { institutionId: { not: null } };
  if (req.query.role) where.role = req.query.role;
  const search = (req.query.search || '').trim();
  if (search) {
    where.OR = [
      { username: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { counselorProfile: { fullName: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        counselorProfile: {
          select: { id: true, fullName: true, mobile: true, availability: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  const staff = users.map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    fullName: u.counselorProfile?.fullName,
    mobile: u.counselorProfile?.mobile,
    availability: u.counselorProfile?.availability,
    createdAt: u.createdAt,
  }));

  res.json({
    success: true,
    data: {
      staff,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// @route   POST /api/super-admin/staff
// @desc    Create staff (Admin, Counselor, or Management) - uses existing field structure
// @access  Private (Super Admin)
router.post('/', [
  body('role').isIn(['ADMIN', 'COUNSELOR', 'MANAGEMENT']).withMessage('Role must be ADMIN, COUNSELOR, or MANAGEMENT'),
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('institutionId').optional().trim(), // Required for Platform Super Admin
  // Counselor-specific (from counselorFields)
  body('fullName').optional().trim(),
  body('mobile').optional().trim(),
  body('expertise').optional().isArray(),
  body('languages').optional().isArray(),
  body('availability').optional().isIn(['ACTIVE', 'INACTIVE', 'AWAY', 'OFFLINE']),
  body('maxCapacity').optional().isInt({ min: 1 }),
  body('schoolId').optional().trim(),
  body('customData').optional().isObject(),
], asyncHandler(async (req, res) => {
  const instId = resolveInstitutionId(req);
  if (!instId) {
    return res.status(400).json({
      success: false,
      message: 'Institution ID is required (Platform Super Admin must pass institutionId)',
    });
  }

  // Verify Super Admin has access to this institution
  if (!isPlatformSuperAdmin(req) && instId !== req.institutionId) {
    return res.status(403).json({ success: false, message: 'Access denied to this institution' });
  }

  const institution = await prisma.institution.findUnique({
    where: { id: instId },
  });
  if (!institution) {
    return res.status(404).json({ success: false, message: 'Institution not found' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  }

  const {
    role,
    username,
    email,
    password,
    fullName,
    mobile,
    expertise,
    languages,
    availability,
    maxCapacity,
    schoolId,
    customData,
  } = req.body;

  // For Counselor, validate per Settings (counselorFields)
  if (role === 'COUNSELOR') {
    const settings = await getFormFieldSettings();
    const cfg = settings.counselorFields || {};
    const isRequired = (key) => {
      if (cfg[key] === false) return false;
      if (['username', 'email', 'password'].includes(key)) return true;
      return cfg.requiredFields?.[key] === true;
    };
    const validationErrors = [];
    if (isRequired('fullName') && (!fullName || !String(fullName).trim())) {
      validationErrors.push({ msg: 'Full name is required', path: 'fullName' });
    }
    if (isRequired('mobile') && (!mobile || !String(mobile).trim())) {
      validationErrors.push({ msg: 'Mobile number is required', path: 'mobile' });
    }
    if (isRequired('expertise') && (!Array.isArray(expertise) || expertise.length === 0)) {
      validationErrors.push({ msg: 'At least one expertise is required', path: 'expertise' });
    }
    if (isRequired('languages') && (!Array.isArray(languages) || languages.length === 0)) {
      validationErrors.push({ msg: 'At least one language is required', path: 'languages' });
    }
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
      });
    }
  }

  // Only reject if same username/email exists within this institution
  const existingUser = await prisma.user.findFirst({
    where: { institutionId: instId, OR: [{ username }, { email }] },
  });
  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: 'User with this username or email already exists in this institution',
    });
  }

  const hashedPassword = await hashPassword(password);

  if (role === 'COUNSELOR') {
    const finalFullName = fullName?.trim() || 'N/A';
    const finalMobile = mobile?.trim() || '';
    const finalExpertise = Array.isArray(expertise) ? expertise : [];
    const finalLanguages = Array.isArray(languages) ? languages : [];
    const finalSchoolId = schoolId || null;

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          email,
          password: hashedPassword,
          role: 'COUNSELOR',
          institutionId: instId,
          isActive: true,
        },
      });

      const counselorProfile = await tx.counselorProfile.create({
        data: {
          userId: user.id,
          fullName: finalFullName,
          mobile: finalMobile,
          expertise: finalExpertise,
          languages: finalLanguages,
          availability: availability || 'ACTIVE',
          maxCapacity: Math.max(1, parseInt(maxCapacity, 10) || 50),
          schoolId: finalSchoolId,
        },
      });

      if (customData && typeof customData === 'object' && Object.keys(customData).length > 0) {
        const valueStr = JSON.stringify(customData);
        await tx.$executeRaw(Prisma.sql`
          UPDATE "counselor_profiles" SET "customData" = ${valueStr}::jsonb WHERE "id" = ${counselorProfile.id}
        `);
      }

      return { user, counselorProfile };
    });

    // So the counselor can log in at Pravidya Counselor Portal: create AcademyUser for this institution's academy
    const academy = await getAcademyForInstitution(institution);
    if (academy) {
      const emailNorm = email.trim().toLowerCase();
      const fullNameVal = fullName?.trim() || result.user.username;
      await prisma.academyUser.upsert({
        where: { academyId_email: { academyId: academy.id, email: emailNorm } },
        update: { passwordHash: hashedPassword, role: 'COUNSELOR', fullName: fullNameVal },
        create: {
          academyId: academy.id,
          role: 'COUNSELOR',
          email: emailNorm,
          passwordHash: hashedPassword,
          fullName: fullNameVal,
        },
      });
    }

    const { password: _, ...userWithoutPassword } = result.user;
    return res.status(201).json({
      success: true,
      message: 'Counselor created successfully',
      data: {
        user: userWithoutPassword,
        counselorProfile: result.counselorProfile,
      },
    });
  }

  // Admin or Management
  const user = await prisma.user.create({
    data: {
      username,
      email,
      password: hashedPassword,
      role,
      institutionId: instId,
      isActive: true,
    },
  });

  // So the school admin/management can log in at Pravidya: create AcademyUser for this institution's academy
  const academy = await getAcademyForInstitution(institution);
  if (academy) {
    const emailNorm = email.trim().toLowerCase();
    const academyRole = role === 'ADMIN' ? 'ADMIN' : role === 'MANAGEMENT' ? 'MANAGEMENT' : 'ADMIN';
    await prisma.academyUser.upsert({
      where: { academyId_email: { academyId: academy.id, email: emailNorm } },
      update: { passwordHash: hashedPassword, role: academyRole, fullName: fullName?.trim() || null },
      create: {
        academyId: academy.id,
        role: academyRole,
        email: emailNorm,
        passwordHash: hashedPassword,
        fullName: fullName?.trim() || null,
      },
    });
  }

  const { password: _, ...userWithoutPassword } = user;
  res.status(201).json({
    success: true,
    message: `${role} created successfully`,
    data: { user: userWithoutPassword },
  });
}));

// @route   PATCH /api/super-admin/staff/:id
// @desc    Toggle staff isActive
// @access  Private (Super Admin)
router.patch('/:id', [
  body('isActive').isBoolean().withMessage('isActive must be boolean'),
], asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) {
    return res.status(404).json({ success: false, message: 'Staff not found' });
  }

  if (!user.institutionId) {
    return res.status(403).json({ success: false, message: 'Cannot modify legacy/global users' });
  }

  if (!isPlatformSuperAdmin(req) && user.institutionId !== req.institutionId) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  await prisma.user.update({
    where: { id },
    data: { isActive },
  });

  res.json({
    success: true,
    message: `Staff ${isActive ? 'activated' : 'deactivated'}`,
  });
}));

export default router;
