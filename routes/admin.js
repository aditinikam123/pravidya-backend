import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';
import { hashPassword } from '../utils/password.js';

const router = express.Router();

// All routes require Admin authentication
router.use(authenticate);
router.use(authorize('ADMIN'));

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard statistics (single batch for speed)
// @access  Private (Admin)
router.get('/dashboard', asyncHandler(async (req, res) => {
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  // Run all independent counts in one batch
  const [
    totalLeads,
    rawLeads,
    verifiedLeads,
    priorityLeads,
    autoAssigned,
    manuallyAssigned,
    unassigned,
    enrolled,
    totalCounselors,
    activeCounselors,
    inactiveCounselors,
    recentLeads,
    recentActivity,
    enrolledByCounselor
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { classification: 'RAW' } }),
    prisma.lead.count({ where: { classification: 'VERIFIED' } }),
    prisma.lead.count({ where: { classification: 'PRIORITY' } }),
    prisma.lead.count({ where: { autoAssigned: true } }),
    prisma.lead.count({ where: { autoAssigned: false, assignedCounselorId: { not: null } } }),
    prisma.lead.count({ where: { assignedCounselorId: null } }),
    prisma.lead.count({ where: { status: 'ENROLLED' } }),
    prisma.counselorProfile.count(),
    prisma.counselorProfile.count({ where: { availability: 'ACTIVE' } }),
    prisma.counselorProfile.count({ where: { availability: 'INACTIVE' } }),
    prisma.lead.count({ where: { submittedAt: { gte: oneDayAgo } } }),
    prisma.activityLog.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.lead.groupBy({
      by: ['assignedCounselorId'],
      where: { status: 'ENROLLED', assignedCounselorId: { not: null } },
      _count: { id: true }
    })
  ]);

  const counselorCounts = {};
  (enrolledByCounselor || []).forEach((g) => {
    if (g.assignedCounselorId) counselorCounts[g.assignedCounselorId] = g._count?.id ?? 0;
  });
  const topCounselorIds = (enrolledByCounselor || [])
    .sort((a, b) => (b._count?.id ?? 0) - (a._count?.id ?? 0))
    .slice(0, 5)
    .map((g) => g.assignedCounselorId)
    .filter(Boolean);
  const topCounselorsData = topCounselorIds.length
    ? await prisma.counselorProfile.findMany({
        where: { id: { in: topCounselorIds } },
        select: { id: true, fullName: true }
      })
    : [];
  const topCounselors = topCounselorIds.map((id) => {
    const counselor = topCounselorsData.find((c) => c.id === id);
    return {
      counselorName: counselor?.fullName || 'Unknown',
      enrolledCount: counselorCounts[id] ?? 0
    };
  });

  res.json({
    success: true,
    data: {
      leads: {
        total: totalLeads,
        classification: { raw: rawLeads, verified: verifiedLeads, priority: priorityLeads },
        assignment: { auto: autoAssigned, manual: manuallyAssigned, unassigned },
        enrolled
      },
      counselors: { total: totalCounselors, active: activeCounselors, inactive: inactiveCounselors },
      recent: { leads: recentLeads, activity: recentActivity },
      topCounselors
    }
  });
}));

// @route   GET /api/admin/activity-logs
// @desc    Get activity logs
// @access  Private (Admin)
router.get('/activity-logs', [
  query('entityType').optional(),
  query('user').optional(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], asyncHandler(async (req, res) => {
  const { entityType, user, page = 1, limit = 50 } = req.query;
  const where = {};

  if (entityType) where.entityType = entityType;
  if (user) where.userId = user;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        user: {
          select: { username: true, email: true, role: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit)
    }),
    prisma.activityLog.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

// @route   POST /api/admin/users
// @desc    Create admin user
// @access  Private (Admin)
router.post('/users', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').isIn(['ADMIN', 'COUNSELOR']).withMessage('Role must be ADMIN or COUNSELOR')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { username, email, password, role } = req.body;

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ username }, { email }]
    }
  });

  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: 'User with this username or email already exists'
    });
  }

  const hashedPassword = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      username,
      email,
      password: hashedPassword,
      role,
      isActive: true
    }
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'CREATE_USER',
      entityType: 'USER',
      entityId: user.id,
      details: { username, email, role }
    }
  });

  const { password: _, ...userWithoutPassword } = user;

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: { user: userWithoutPassword }
  });
}));

// Default form field configs (all enabled)
const DEFAULT_COUNSELOR_FIELDS = {
  username: true, email: true, password: true, fullName: true, mobile: true,
  expertise: true, languages: true, availability: true, maxCapacity: true, schoolId: true,
  customFields: [],
};
const DEFAULT_INSTITUTION_FIELDS = {
  name: true, type: true, address: true, pincode: true, city: true, state: true, isActive: true,
  logoUrl: true, boardsOffered: true, standardsAvailable: true, streamsOffered: true,
  admissionsOpen: true, boardGradeMap: true, customFields: [],
  requiredFields: {},
};
const DEFAULT_COURSE_FIELDS = {
  name: true, code: true, description: true, duration: true, eligibility: true, isActive: true,
  customFields: [],
  requiredFields: {},
};
const DEFAULT_SCHOOL_COURSE_FIELDS = {
  board: true, standardRange: true, stream: true, seats: true, admissionsOpen: true,
  customFields: [],
};
const DEFAULT_SCHOOL_FIELDS = {
  name: true, type: true, logo: true, boards: true, address: true, city: true, state: true, active: true,
  customFields: [],
};
const DEFAULT_ADMISSION_FORM_FIELDS = {
  parentName: true, parentMobile: true, parentEmail: true, parentCity: true,
  preferredLanguage: true, studentName: true, dateOfBirth: true, gender: true,
  currentClass: true, boardUniversity: true, marksPercentage: true,
  institution: true, course: true, academicYear: true, preferredCounselingMode: true, notes: true,
  customFields: [],
};

const SETTING_KEYS = [
  { key: 'counselorFields', default: DEFAULT_COUNSELOR_FIELDS },
  { key: 'institutionFields', default: DEFAULT_INSTITUTION_FIELDS },
  { key: 'courseFields', default: DEFAULT_COURSE_FIELDS },
  { key: 'schoolCourseFields', default: DEFAULT_SCHOOL_COURSE_FIELDS },
  { key: 'schoolFields', default: DEFAULT_SCHOOL_FIELDS },
  { key: 'admissionFormFields', default: DEFAULT_ADMISSION_FORM_FIELDS },
];

async function getFormFieldSettings() {
  const result = {
    counselorFields: { ...DEFAULT_COUNSELOR_FIELDS },
    institutionFields: { ...DEFAULT_INSTITUTION_FIELDS },
    courseFields: { ...DEFAULT_COURSE_FIELDS },
    schoolCourseFields: { ...DEFAULT_SCHOOL_COURSE_FIELDS },
    schoolFields: { ...DEFAULT_SCHOOL_FIELDS },
    admissionFormFields: { ...DEFAULT_ADMISSION_FORM_FIELDS },
  };
  try {
    for (const { key, default: def } of SETTING_KEYS) {
      const rows = await prisma.$queryRaw(Prisma.sql`
        SELECT "value" FROM "app_settings" WHERE "key" = ${key} LIMIT 1
      `);
      const row = Array.isArray(rows) ? rows[0] : null;
      const value = row?.value;
      if (value && typeof value === 'object') {
        result[key] = { ...def, ...value };
      }
    }
  } catch (err) {
    // Table may not exist yet
  }
  return result;
}

// @route   GET /api/admin/settings
// @desc    Get app settings (Admin only)
// @access  Private (Admin)
router.get('/settings', asyncHandler(async (req, res) => {
  const data = await getFormFieldSettings();
  res.json({ success: true, data });
}));

// @route   PUT /api/admin/settings
// @desc    Update app settings (Admin only)
// @access  Private (Admin)
router.put('/settings', [
  body('counselorFields').optional().isObject(),
  body('institutionFields').optional().isObject(),
  body('courseFields').optional().isObject(),
  body('schoolCourseFields').optional().isObject(),
  body('schoolFields').optional().isObject(),
  body('admissionFormFields').optional().isObject(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  const updates = {
    counselorFields: req.body.counselorFields,
    institutionFields: req.body.institutionFields,
    courseFields: req.body.courseFields,
    schoolCourseFields: req.body.schoolCourseFields,
    schoolFields: req.body.schoolFields,
    admissionFormFields: req.body.admissionFormFields,
  };

  for (const { key, default: def } of SETTING_KEYS) {
    const val = updates[key];
    if (val && typeof val === 'object') {
      const value = { ...def, ...val };
      const valueStr = JSON.stringify(value);
      const id = `clx_${key.replace(/[A-Z]/g, (c) => c.toLowerCase())}`;
      const now = new Date();
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "app_settings" ("id", "key", "value", "updatedAt")
        VALUES (${id}, ${key}, ${valueStr}::jsonb, ${now})
        ON CONFLICT ("key") DO UPDATE SET "value" = ${valueStr}::jsonb, "updatedAt" = ${now}
      `);
    }
  }

  const data = await getFormFieldSettings();
  res.json({ success: true, message: 'Settings updated', data });
}));

export { getFormFieldSettings };

export default router;
