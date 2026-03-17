import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { prisma } from '../../prisma/client.js';
import { isPlatformScope, VEMAN_JITOFY_INSTITUTION_ID, LEGACY_PLATFORM_JITOFY_ID } from '../../utils/institutionIds.js';

const router = express.Router();

const isPlatformSuperAdmin = (req) => isPlatformScope(req.superAdmin?.institution);

// @route   GET /api/super-admin/institutions
// @desc    List institutions - Platform: all; Institution: own only
// @access  Private (Super Admin)
router.get('/', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().trim(),
], asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const skip = (page - 1) * limit;
  const search = (req.query.search || '').trim();

  const where = {};
  if (!isPlatformSuperAdmin(req)) {
    where.id = req.institutionId;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { jitofyInstitutionId: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [institutions, total] = await Promise.all([
    prisma.institution.findMany({
      where,
      select: {
        id: true,
        name: true,
        type: true,
        jitofyInstitutionId: true,
        isActive: true,
        city: true,
        state: true,
        _count: { select: { leads: true, courses: true } },
      },
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    prisma.institution.count({ where }),
  ]);

  res.json({
    success: true,
    data: {
      institutions,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// @route   GET /api/super-admin/institutions/:id
// @desc    Get single institution (scoped to Super Admin access)
// @access  Private (Super Admin)
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isPlatformSuperAdmin(req) && id !== req.institutionId) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const institution = await prisma.institution.findUnique({
    where: { id },
    include: {
      courses: { select: { id: true, name: true, code: true, isActive: true } },
      _count: { select: { leads: true } },
    },
  });

  if (!institution) {
    return res.status(404).json({ success: false, message: 'Institution not found' });
  }

  res.json({ success: true, data: { institution } });
}));

// @route   POST /api/super-admin/institutions
// @desc    Onboard new institution - Platform Super Admin only
// @access  Private (Super Admin - Platform)
router.post('/', [
  body('jitofyInstitutionId').trim().notEmpty().withMessage('Institution ID (Jitofy) is required'),
  body('name').trim().notEmpty().withMessage('Institution name is required'),
  body('type').isIn(['School', 'College']).withMessage('Type must be School or College'),
  body('address').optional().trim(),
  body('city').optional().trim(),
  body('state').optional().trim(),
  body('isActive').optional().isBoolean(),
  body('logoUrl').optional().trim(),
  body('customData').optional().isObject(),
], asyncHandler(async (req, res) => {
  if (!isPlatformSuperAdmin(req)) {
    return res.status(403).json({
      success: false,
      message: 'Only Platform Super Admin can onboard new institutions.',
    });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  }

  const { jitofyInstitutionId, name, type, address, city, state, isActive = true, logoUrl, customData } = req.body;
  const jitofyId = String(jitofyInstitutionId).trim();
  const nameTrimmed = name.trim();

  const existingByJitofyId = await prisma.institution.findFirst({
    where: { jitofyInstitutionId: jitofyId },
  });

  if (existingByJitofyId) {
    // Same ID already exists: update it with onboarding details (first-time setup for this school)
    const institution = await prisma.institution.update({
      where: { id: existingByJitofyId.id },
      data: {
        name: nameTrimmed,
        type,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        isActive: !!isActive,
        logoUrl: logoUrl?.trim() || null,
        customData: customData && typeof customData === 'object' ? customData : undefined,
      },
    });
    return res.status(200).json({
      success: true,
      message: 'Institution updated and ready for use',
      data: { institution },
    });
  }

  const existingByName = await prisma.institution.findFirst({
    where: { name: { equals: nameTrimmed, mode: 'insensitive' } },
  });
  if (existingByName) {
    return res.status(400).json({
      success: false,
      message: 'Institution with this name already exists',
    });
  }

  const institution = await prisma.institution.create({
    data: {
      jitofyInstitutionId: jitofyId,
      name: nameTrimmed,
      type,
      address: address?.trim() || null,
      city: city?.trim() || null,
      state: state?.trim() || null,
      isActive: !!isActive,
      logoUrl: logoUrl?.trim() || null,
      customData: customData && typeof customData === 'object' ? customData : undefined,
    },
  });

  res.status(201).json({
    success: true,
    message: 'Institution onboarded successfully',
    data: { institution },
  });
}));

// @route   PUT /api/super-admin/institutions/:id
// @desc    Update institution - Platform: any; Institution: own only
// @access  Private (Super Admin)
router.put('/:id', [
  body('name').optional().trim().notEmpty(),
  body('type').optional().isIn(['School', 'College']),
  body('address').optional().trim(),
  body('city').optional().trim(),
  body('state').optional().trim(),
  body('isActive').optional().isBoolean(),
  body('jitofyInstitutionId').optional().trim(),
], asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isPlatformSuperAdmin(req) && id !== req.institutionId) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const { name, type, address, city, state, isActive, jitofyInstitutionId } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (type !== undefined) updates.type = type;
  if (address !== undefined) updates.address = address?.trim() || null;
  if (city !== undefined) updates.city = city?.trim() || null;
  if (state !== undefined) updates.state = state?.trim() || null;
  if (isActive !== undefined) updates.isActive = !!isActive;
  if (jitofyInstitutionId !== undefined && isPlatformSuperAdmin(req)) {
    const j = String(jitofyInstitutionId).trim();
    const ju = j.toUpperCase();
    // Reserved IDs: only one institution should use Veman / platform scope
    if (
      j &&
      ju !== LEGACY_PLATFORM_JITOFY_ID &&
      ju !== VEMAN_JITOFY_INSTITUTION_ID.toUpperCase()
    ) {
      updates.jitofyInstitutionId = j;
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, message: 'No valid fields to update' });
  }

  const institution = await prisma.institution.update({
    where: { id },
    data: updates,
  });

  res.json({
    success: true,
    message: 'Institution updated',
    data: { institution },
  });
}));

export default router;
