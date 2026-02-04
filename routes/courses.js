import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';
import { generateTrainingForCourse } from '../services/aiTrainingGenerator.js';

const router = express.Router();

// In-memory cache for courses list (10s TTL) — no loop, single query
let courseCache = null;
let lastFetch = 0;
const CACHE_TTL_MS = 10000;

function invalidateCoursesCache() {
  courseCache = null;
  lastFetch = 0;
}

// @route   GET /api/courses
// @desc    Get courses — flat (paginated) or grouped by institution (grouped=true)
// @access  Public (for form) or Private
router.get('/', [
  query('institution').optional(),
  query('isActive').optional().isIn(['true', 'false']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().trim(),
  query('grouped').optional().isIn(['true', 'false'])
], asyncHandler(async (req, res) => {
  const { institution, isActive, search, grouped } = req.query;

  if (grouped === 'true') {
    const courseWhere = {};
    if (institution) courseWhere.institutionId = institution;
    if (isActive !== undefined) courseWhere.isActive = isActive === 'true';
    if (search && search.length > 0) {
      courseWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } }
      ];
    }

    let courses;
    try {
      courses = await prisma.course.findMany({
        where: Object.keys(courseWhere).length ? courseWhere : undefined,
        include: {
          institution: { select: { id: true, name: true, type: true, admissionsOpen: true } }
        },
        orderBy: [{ institutionId: 'asc' }, { name: 'asc' }]
      });
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg.includes('admissionsOpen') || msg.includes('does not exist') || msg.includes('column')) {
        courses = await prisma.course.findMany({
          where: Object.keys(courseWhere).length ? courseWhere : undefined,
          include: {
            institution: { select: { id: true, name: true, type: true } }
          },
          orderBy: [{ institutionId: 'asc' }, { name: 'asc' }]
        });
      } else {
        throw err;
      }
    }

    const byInstitution = new Map();
    for (const course of courses) {
      const id = course.institutionId;
      const inst = course.institution;
      const name = inst?.name ?? 'Unknown';
      if (!byInstitution.has(id)) {
        byInstitution.set(id, {
          institutionId: id,
          institutionName: name,
          institutionType: inst?.type ?? 'College',
          institutionAdmissionsOpen: inst?.admissionsOpen ?? null,
          boardsOffered: [],
          standardsAvailable: [],
          streamsOffered: [],
          courses: []
        });
      }
      const { institution: _i, ...courseData } = course;
      byInstitution.get(id).courses.push(courseData);
    }
    const groups = Array.from(byInstitution.values());

    return res.json({
      success: true,
      data: { groups }
    });
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const where = {};

  if (institution) where.institutionId = institution;
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (search && search.length > 0) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { institution: { name: { contains: search, mode: 'insensitive' } } }
    ];
  }

  const cacheKey = `${institution || ''}_${isActive ?? ''}_${search || ''}_${page}_${limit}`;
  if (Date.now() - lastFetch < CACHE_TTL_MS && courseCache && courseCache.cacheKey === cacheKey) {
    return res.json(courseCache.payload);
  }

  const [courses, total] = await Promise.all([
    prisma.course.findMany({
      where,
      include: {
        institution: {
          select: { id: true, name: true, type: true }
        }
      },
      orderBy: { name: 'asc' },
      skip,
      take: limit
    }),
    prisma.course.count({ where })
  ]);

  const payload = {
    success: true,
    data: {
      courses,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    }
  };
  courseCache = { cacheKey, payload };
  lastFetch = Date.now();
  res.json(payload);
}));

// @route   GET /api/courses/:id
// @desc    Get single course
// @access  Public
router.get('/:id', asyncHandler(async (req, res) => {
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    include: {
      institution: {
        select: { name: true, type: true, address: true, city: true, state: true }
      }
    }
  });

  if (!course) {
    return res.status(404).json({
      success: false,
      message: 'Course not found'
    });
  }

  res.json({
    success: true,
    data: { course }
  });
}));

// Validate school admission entry against institution's academic structure
function validateSchoolEntry(institution, body) {
  const { board, standardRange, stream } = body;
  const errors = [];
  if (!board) errors.push({ msg: 'Board is required for school entry' });
  else if (!(institution.boardsOffered || []).includes(board)) {
    errors.push({ msg: `Board must be one of: ${(institution.boardsOffered || []).join(', ')}` });
  }
  if (!standardRange) errors.push({ msg: 'Standard range is required for school entry' });
  else if (!(institution.standardsAvailable || []).includes(standardRange)) {
    errors.push({ msg: `Standard range must be one of: ${(institution.standardsAvailable || []).join(', ')}` });
  }
  if (stream && !(institution.streamsOffered || []).includes(stream)) {
    errors.push({ msg: `Stream must be one of: ${(institution.streamsOffered || []).join(', ')}` });
  }
  if (standardRange === '11–12' && !stream) {
    errors.push({ msg: 'Stream is required when standard range is 11–12' });
  }
  return errors;
}

// @route   POST /api/courses
// @desc    Create course or school admission entry (Admin only)
// @access  Private (Admin)
router.post('/', authenticate, authorize('ADMIN'), [
  body('institution').notEmpty().withMessage('Institution is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const institution = await prisma.institution.findUnique({
    where: { id: req.body.institution },
    select: { id: true, name: true, type: true }
  });

  if (!institution) {
    return res.status(404).json({
      success: false,
      message: 'Institution not found'
    });
  }

  let name, code, description, duration, eligibility, isActive;
  if (institution.type === 'School') {
    name = [req.body.board, req.body.standardRange, req.body.stream].filter(Boolean).join(' ') || 'School entry';
    code = null;
    description = null;
    duration = null;
    eligibility = null;
    isActive = true;
  } else {
    if (!(req.body.name && req.body.name.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: [{ msg: 'Course name is required for college' }]
      });
    }
    name = req.body.name.trim();
    code = req.body.code || null;
    description = req.body.description || null;
    duration = req.body.duration || null;
    eligibility = req.body.eligibility || null;
    isActive = req.body.isActive !== undefined ? req.body.isActive : true;
  }

  const courseData = {
    name,
    code,
    description,
    institutionId: req.body.institution,
    duration,
    eligibility,
    isActive
  };

  invalidateCoursesCache();
  const course = await prisma.course.create({
    data: courseData,
    include: {
      institution: {
        select: { name: true, type: true }
      }
    }
  });

  // Generate AI training content automatically
  let trainingModules = [];
  try {
    const trainingResult = await generateTrainingForCourse(course.id, req.userId);
    trainingModules = trainingResult.modules;
  } catch (error) {
    console.error('Failed to generate AI training content:', error);
    // Continue even if AI generation fails
  }

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'CREATE_COURSE',
      entityType: 'COURSE',
      entityId: course.id,
      details: {
        ...req.body,
        trainingModulesGenerated: trainingModules.length
      }
    }
  });

  res.status(201).json({
    success: true,
    message: 'Course created successfully. Training content generated automatically.',
    data: { 
      course,
      trainingModules: trainingModules.length > 0 ? trainingModules : undefined
    }
  });
}));

// @route   PUT /api/courses/:id
// @desc    Update course or school entry (Admin only)
// @access  Private (Admin)
router.put('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    include: {
      institution: {
        select: { id: true, type: true }
      }
    }
  });

  if (!course) {
    return res.status(404).json({
      success: false,
      message: 'Course not found'
    });
  }

  const institution = course.institution;
  let name, code, description, duration, eligibility, isActive;
  if (institution?.type === 'School') {
    name = [req.body.board, req.body.standardRange, req.body.stream].filter(Boolean).join(' ') || course.name;
    code = null;
    description = null;
    duration = null;
    eligibility = null;
    isActive = course.isActive;
  } else {
    if (req.body.name !== undefined && !String(req.body.name).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Course name is required for college'
      });
    }
    name = req.body.name !== undefined ? req.body.name.trim() : course.name;
    code = req.body.code !== undefined ? req.body.code : course.code;
    description = req.body.description !== undefined ? req.body.description : course.description;
    duration = req.body.duration !== undefined ? req.body.duration : course.duration;
    eligibility = req.body.eligibility !== undefined ? req.body.eligibility : course.eligibility;
    isActive = req.body.isActive !== undefined ? req.body.isActive : course.isActive;
  }

  const updateData = {
    name,
    code,
    description,
    duration,
    eligibility,
    isActive
  };
  if (req.body.institution) {
    updateData.institutionId = req.body.institution;
  }

  invalidateCoursesCache();
  const updatedCourse = await prisma.course.update({
    where: { id: req.params.id },
    data: updateData,
    include: {
      institution: {
        select: { name: true, type: true }
      }
    }
  });

  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'UPDATE_COURSE',
      entityType: 'COURSE',
      entityId: course.id,
      details: req.body
    }
  });

  res.json({
    success: true,
    message: 'Course updated successfully',
    data: { course: updatedCourse }
  });
}));

// @route   DELETE /api/courses/:id
// @desc    Delete course (Admin only) with cascading
// @access  Private (Admin)
router.delete('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    include: {
      leads: {
        select: { id: true }
      },
      trainingModules: {
        select: { id: true, title: true }
      }
    }
  });

  if (!course) {
    return res.status(404).json({
      success: false,
      message: 'Course not found'
    });
  }

  // Check for related leads
  if (course.leads.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Cannot delete course with assigned leads',
      details: {
        leads: course.leads.length
      }
    });
  }

  invalidateCoursesCache();
  await prisma.$transaction(async (tx) => {
    if (course.trainingModules.length > 0) {
      await tx.trainingModule.deleteMany({
        where: { courseId: req.params.id }
      });
    }

    // Delete course
    await tx.course.delete({
      where: { id: req.params.id }
    });

    // Log activity
    await tx.activityLog.create({
      data: {
        userId: req.userId,
        action: 'DELETE_COURSE',
        entityType: 'COURSE',
        entityId: course.id
      }
    });
  });

  res.json({
    success: true,
    message: 'Course deleted successfully'
  });
}));

export default router;
