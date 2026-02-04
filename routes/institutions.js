import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const router = express.Router();

// In-memory cache for active institutions list (heavy dropdown data)
let institutionsCache = null;

function invalidateInstitutionsCache() {
  institutionsCache = null;
}

// @route   GET /api/institutions
// @desc    Get all institutions (paginated for speed); cache when listing active only
// @access  Public (for form) or Private (for admin)
router.get('/', [
  query('type').optional().isIn(['School', 'College']),
  query('isActive').optional().isIn(['true', 'false']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 100;
  const skip = (page - 1) * limit;
  const { type, isActive, search } = req.query;
  const where = {};

  if (type) where.type = type;
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  // Use cache only for first page of active institutions, no search (dropdown use)
  const useCache = !search && (isActive === 'true' || isActive === undefined) && page === 1 && limit >= 50;
  if (useCache && institutionsCache) {
    return res.json(institutionsCache);
  }

  const fullSelect = {
    id: true,
    name: true,
    type: true,
    address: true,
    city: true,
    state: true,
    isActive: true,
    boardsOffered: true,
    standardsAvailable: true,
    streamsOffered: true,
    admissionsOpen: true,
    admissionsOpenByStandard: true,
    admissionsOpenGrades: true,
    admissionsOpenStreams: true,
    boardsByStandard: true,
    boardGradeMap: true,
    logoUrl: true,
    courses: { select: { id: true, name: true, code: true, isActive: true } },
    leads: { select: { id: true } }
  };
  const minimalSelect = {
    id: true,
    name: true,
    type: true,
    address: true,
    city: true,
    state: true,
    isActive: true,
    courses: { select: { id: true, name: true, code: true, isActive: true } }
  };

  let institutions, total;
  try {
    const [list, cnt] = await Promise.all([
      prisma.institution.findMany({
        where,
        select: fullSelect,
        orderBy: { name: 'asc' },
        skip,
        take: limit
      }),
      prisma.institution.count({ where })
    ]);
    institutions = list;
    total = cnt;
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (msg.includes('boardsOffered') || msg.includes('does not exist') || msg.includes('column')) {
      const [list, cnt] = await Promise.all([
        prisma.institution.findMany({
          where,
          select: minimalSelect,
          orderBy: { name: 'asc' },
          skip,
          take: limit
        }),
        prisma.institution.count({ where })
      ]);
      institutions = list;
      total = cnt;
    } else {
      throw err;
    }
  }

  const payload = {
    success: true,
    data: {
      institutions,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    }
  };
  if (useCache) {
    institutionsCache = payload;
  }
  res.json(payload);
}));

// @route   GET /api/institutions/:id
// @desc    Get single institution
// @access  Public
router.get('/:id', asyncHandler(async (req, res) => {
  const minimalSelect = {
    id: true,
    name: true,
    type: true,
    address: true,
    city: true,
    state: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
    courses: {
      select: { id: true, name: true, code: true, description: true, duration: true, eligibility: true, isActive: true }
    }
  };

  let institution;
  try {
    institution = await prisma.institution.findUnique({
      where: { id: req.params.id },
      include: {
        courses: {
          select: { id: true, name: true, code: true, description: true, duration: true, eligibility: true, isActive: true }
        }
      }
    });
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (msg.includes('boardsOffered') || msg.includes('does not exist') || msg.includes('column')) {
      institution = await prisma.institution.findUnique({
        where: { id: req.params.id },
        select: minimalSelect
      });
    } else {
      throw err;
    }
  }

  if (!institution) {
    return res.status(404).json({
      success: false,
      message: 'Institution not found'
    });
  }

  res.json({
    success: true,
    data: { institution }
  });
}));

// Derive admissionsOpenByStandard from array of grades 1-12 (for backward compatibility)
function admissionsOpenByStandardFromGrades(grades) {
  if (!Array.isArray(grades)) return null;
  const set = new Set(grades.map((g) => Number(g)).filter((g) => g >= 1 && g <= 12));
  return {
    '1-5': [1, 2, 3, 4, 5].some((g) => set.has(g)),
    '6-10': [6, 7, 8, 9, 10].some((g) => set.has(g)),
    '11-12': [11, 12].some((g) => set.has(g))
  };
}

// @route   POST /api/institutions
// @desc    Create institution (Admin only)
// @access  Private (Admin)
function sanitizeInstitutionPayload(body) {
  const { type, boardsOffered, standardsAvailable, streamsOffered, admissionsOpen, admissionsOpenByStandard, admissionsOpenGrades, admissionsOpenStreams, boardsByStandard, boardGradeMap } = body;
  const data = { ...body };
  if (type === 'College') {
    data.boardsOffered = [];
    data.standardsAvailable = [];
    data.streamsOffered = [];
    data.admissionsOpen = null;
    data.admissionsOpenByStandard = null;
    data.admissionsOpenGrades = null;
    data.admissionsOpenStreams = null;
    data.boardsByStandard = null;
    data.boardGradeMap = null;
  } else {
    data.boardGradeMap = boardGradeMap && typeof boardGradeMap === 'object' ? boardGradeMap : {};
    const map = data.boardGradeMap;
    const boards = Object.keys(map).filter((b) => b && typeof map[b] === 'object');
    const allBoards = new Set(boards);
    const standardsSet = new Set();
    boards.forEach((board) => {
      const g = map[board];
      if (Array.isArray(g.primary) && g.primary.length > 0) standardsSet.add('Primary');
      if (Array.isArray(g.middle) && g.middle.length > 0) standardsSet.add('Middle');
      if (Array.isArray(g.high) && g.high.length > 0) standardsSet.add('High');
    });
    data.boardsOffered = boards.length > 0 ? Array.from(allBoards) : (Array.isArray(boardsOffered) ? boardsOffered : []);
    data.standardsAvailable = standardsSet.size > 0 ? Array.from(standardsSet) : (Array.isArray(standardsAvailable) ? standardsAvailable : []);
    data.streamsOffered = Array.isArray(streamsOffered) ? streamsOffered : [];
    // Per-grade admissions: normalize to sorted array 1-12; derive range-based for backward compat
    if (Array.isArray(admissionsOpenGrades)) {
      const grades = [...new Set(admissionsOpenGrades.map((g) => Number(g)).filter((g) => g >= 1 && g <= 12))].sort((a, b) => a - b);
      data.admissionsOpenGrades = grades;
      data.admissionsOpenByStandard = admissionsOpenByStandardFromGrades(grades);
      data.admissionsOpen = grades.length > 0;
    } else {
      data.admissionsOpen = admissionsOpen === true || admissionsOpen === 'true';
      data.admissionsOpenByStandard = admissionsOpenByStandard && typeof admissionsOpenByStandard === 'object' ? admissionsOpenByStandard : {};
    }
    if (Array.isArray(admissionsOpenStreams)) data.admissionsOpenStreams = admissionsOpenStreams.filter((s) => typeof s === 'string' && s.trim());
    data.boardsByStandard = boardsByStandard && typeof boardsByStandard === 'object' ? boardsByStandard : {};
  }
  return data;
}

// Only fields that exist in DB before migration (boardsOffered etc.). Use this for Prisma create/update until migration is run.
function institutionDataForPrisma(data) {
  const { name, type, address, city, state, isActive } = data;
  return { name, type, address, city, state, isActive };
}

// Max logo file size: 2 MB (validated for data URLs)
const MAX_LOGO_FILE_SIZE_BYTES = 2 * 1024 * 1024;

function validateLogoUrlSize(logoUrl) {
  if (!logoUrl || typeof logoUrl !== 'string') return null;
  if (!logoUrl.startsWith('data:')) return null; // external URLs not size-checked
  const base64 = logoUrl.indexOf(',') >= 0 ? logoUrl.slice(logoUrl.indexOf(',') + 1) : '';
  const approximateBytes = (base64.length * 3) / 4;
  if (approximateBytes > MAX_LOGO_FILE_SIZE_BYTES) {
    return `Logo image is too large. Maximum allowed size is 2 MB. Please upload a smaller image.`;
  }
  return null;
}

// Payload without logoUrl (use when Prisma client/DB doesn't support logoUrl yet)
function withoutLogoUrl(data) {
  const { logoUrl, ...rest } = data;
  return rest;
}
// Payload without admissionsOpenByStandard (use when column doesn't exist yet)
function withoutAdmissionsOpenByStandard(data) {
  const { admissionsOpenByStandard, ...rest } = data;
  return rest;
}
// Payload without admissionsOpenGrades (use when column doesn't exist yet)
function withoutAdmissionsOpenGrades(data) {
  const { admissionsOpenGrades, ...rest } = data;
  return rest;
}
// Payload without admissionsOpenStreams (use when column doesn't exist yet)
function withoutAdmissionsOpenStreams(data) {
  const { admissionsOpenStreams, ...rest } = data;
  return rest;
}
// Payload without boardGradeMap (use when column doesn't exist yet)
function withoutBoardGradeMap(data) {
  const { boardGradeMap, ...rest } = data;
  return rest;
}

function isLogoUrlError(err) {
  const msg = String(err?.message || err || '');
  return msg.includes('logoUrl') || msg.includes('Unknown argument');
}
function isAdmissionsOpenByStandardError(err) {
  const msg = String(err?.message ?? err ?? '') + (err?.stack ? String(err.stack) : '');
  return /admissionsOpenByStandard/i.test(msg) || /Unknown argument/i.test(msg) || (msg.includes('Invalid') && msg.includes('institution.update'));
}
function isAdmissionsOpenGradesError(err) {
  const msg = String(err?.message ?? err ?? '') + (err?.stack ? String(err.stack) : '');
  return /admissionsOpenGrades/i.test(msg) || /Unknown argument/i.test(msg) || (msg.includes('Invalid') && msg.includes('institution.update'));
}
function isAdmissionsOpenStreamsError(err) {
  const msg = String(err?.message ?? err ?? '') + (err?.stack ? String(err.stack) : '');
  return /admissionsOpenStreams/i.test(msg) || /Unknown argument/i.test(msg);
}
// Minimal payload for update when schema/DB is missing optional columns
function minimalUpdatePayload(data) {
  const {
    admissionsOpenGrades, admissionsOpenByStandard, admissionsOpenStreams, boardGradeMap, boardsByStandard, logoUrl,
    ...rest
  } = data;
  return rest;
}
function isBoardGradeMapError(err) {
  const msg = String(err?.message ?? err ?? '') + (err?.stack ? String(err.stack) : '');
  return /boardGradeMap/i.test(msg) || /Unknown argument/i.test(msg);
}

router.post('/', authenticate, authorize('ADMIN'), [
  body('name').trim().notEmpty().withMessage('Institution name is required'),
  body('type').isIn(['School', 'College']).withMessage('Type must be School or College')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const fullData = sanitizeInstitutionPayload(req.body);
  const logoError = validateLogoUrlSize(fullData.logoUrl);
  if (logoError) {
    return res.status(400).json({
      success: false,
      message: logoError
    });
  }
  let institution;
  try {
    institution = await prisma.institution.create({ data: fullData });
  } catch (err) {
    if (isLogoUrlError(err)) {
      institution = await prisma.institution.create({ data: withoutLogoUrl(fullData) });
    } else if (isAdmissionsOpenByStandardError(err)) {
      institution = await prisma.institution.create({ data: withoutAdmissionsOpenByStandard(fullData) });
    } else if (isAdmissionsOpenGradesError(err)) {
      institution = await prisma.institution.create({ data: withoutAdmissionsOpenGrades(fullData) });
    } else if (isAdmissionsOpenStreamsError(err)) {
      institution = await prisma.institution.create({ data: withoutAdmissionsOpenStreams(fullData) });
    } else if (isBoardGradeMapError(err)) {
      institution = await prisma.institution.create({ data: withoutBoardGradeMap(fullData) });
    } else {
      throw err;
    }
  }

  invalidateInstitutionsCache();
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'CREATE_INSTITUTION',
      entityType: 'INSTITUTION',
      entityId: institution.id,
      details: req.body
    }
  });

  res.status(201).json({
    success: true,
    message: 'Institution created successfully',
    data: { institution }
  });
}));

// Minimal select so findUnique works when boardsOffered etc. columns don't exist yet
const institutionMinimalSelect = {
  id: true,
  name: true,
  type: true,
  address: true,
  city: true,
  state: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
};

// @route   PUT /api/institutions/:id
// @desc    Update institution (Admin only)
// @access  Private (Admin)
router.put('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  let institution;
  try {
    institution = await prisma.institution.findUnique({
      where: { id: req.params.id }
    });
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (msg.includes('boardsOffered') || msg.includes('does not exist') || msg.includes('column')) {
      institution = await prisma.institution.findUnique({
        where: { id: req.params.id },
        select: institutionMinimalSelect
      });
    } else {
      throw err;
    }
  }

  if (!institution) {
    return res.status(404).json({
      success: false,
      message: 'Institution not found'
    });
  }

  const fullData = sanitizeInstitutionPayload({ ...req.body, type: req.body.type ?? institution.type });
  const logoError = validateLogoUrlSize(fullData.logoUrl);
  if (logoError) {
    return res.status(400).json({
      success: false,
      message: logoError
    });
  }
  let updatedInstitution;
  try {
    updatedInstitution = await prisma.institution.update({
      where: { id: req.params.id },
      data: fullData
    });
  } catch (err) {
    let dataToUse = fullData;
    const isLogo = isLogoUrlError(err);
    const isAdmissions = isAdmissionsOpenByStandardError(err);
    const isAdmissionsGrades = isAdmissionsOpenGradesError(err);
    const isAdmissionsStreams = isAdmissionsOpenStreamsError(err);
    const isBoardGrade = isBoardGradeMapError(err);
    if (isLogo || isAdmissions || isAdmissionsGrades || isAdmissionsStreams || isBoardGrade) {
      if (isBoardGrade) dataToUse = withoutBoardGradeMap(dataToUse);
      if (isAdmissions) dataToUse = withoutAdmissionsOpenByStandard(dataToUse);
      if (isAdmissionsGrades) dataToUse = withoutAdmissionsOpenGrades(dataToUse);
      if (isAdmissionsStreams) dataToUse = withoutAdmissionsOpenStreams(dataToUse);
      if (isLogo) dataToUse = withoutLogoUrl(dataToUse);
      try {
        updatedInstitution = await prisma.institution.update({
          where: { id: req.params.id },
          data: dataToUse
        });
      } catch (err2) {
        // Second retry: strip all optional columns so update succeeds (admissionsOpenGrades, boardGradeMap, boardsByStandard, logoUrl)
        const minimal = minimalUpdatePayload(dataToUse);
        updatedInstitution = await prisma.institution.update({
          where: { id: req.params.id },
          data: minimal
        });
      }
    } else {
      throw err;
    }
  }

  invalidateInstitutionsCache();
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'UPDATE_INSTITUTION',
      entityType: 'INSTITUTION',
      entityId: institution.id,
      details: req.body
    }
  });

  res.json({
    success: true,
    message: 'Institution updated successfully',
    data: { institution: updatedInstitution }
  });
}));

// @route   DELETE /api/institutions/:id
// @desc    Delete institution (Admin only) with cascading
// @access  Private (Admin)
router.delete('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  let institution;
  try {
    institution = await prisma.institution.findUnique({
      where: { id: req.params.id },
      include: {
        courses: { select: { id: true, name: true } },
        leads: { select: { id: true } }
      }
    });
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (msg.includes('boardsOffered') || msg.includes('does not exist') || msg.includes('column')) {
      institution = await prisma.institution.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          courses: { select: { id: true } },
          leads: { select: { id: true } }
        }
      });
    } else {
      throw err;
    }
  }

  if (!institution) {
    return res.status(404).json({
      success: false,
      message: 'Institution not found'
    });
  }

  // Check for related data
  const hasCourses = institution.courses.length > 0;
  const hasLeads = institution.leads.length > 0;

  if (hasCourses || hasLeads) {
    return res.status(400).json({
      success: false,
      message: 'Cannot delete institution with related courses or leads',
      details: {
        courses: institution.courses.length,
        leads: institution.leads.length
      }
    });
  }

  invalidateInstitutionsCache();
  await prisma.$transaction(async (tx) => {
    // Delete institution (courses and leads already checked)
    await tx.institution.delete({
      where: { id: req.params.id }
    });

    // Log activity
    await tx.activityLog.create({
      data: {
        userId: req.userId,
        action: 'DELETE_INSTITUTION',
        entityType: 'INSTITUTION',
        entityId: institution.id
      }
    });
  });

  res.json({
    success: true,
    message: 'Institution deleted successfully'
  });
}));

export default router;
