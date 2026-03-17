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

async function getSystemSettings() {
  // Ensure a row exists (single-row semantics)
  const existing = await prisma.systemSettings.findFirst({
    select: { id: true, leadAssignmentMode: true, lastRoundRobinIndex: true, updatedAt: true },
  });
  if (existing) return existing;
  return await prisma.systemSettings.create({
    data: { leadAssignmentMode: 'language', lastRoundRobinIndex: -1 },
    select: { id: true, leadAssignmentMode: true, lastRoundRobinIndex: true, updatedAt: true },
  });
}

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard statistics (single batch for speed)
// @access  Private (Admin)
router.get('/dashboard', asyncHandler(async (req, res) => {
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  // Run all independent counts in one batch
  // Lead classification (per user: Counseling In Progress = all statuses except New and Enrolled):
  // - New = status NEW
  // - Counseling In Progress = ALL leads with status not NEW and not ENROLLED (includes CONTACTED, FOLLOW_UP, REJECTED, ON_HOLD, PRIORITY, etc.)
  // - Priority = classification PRIORITY and not enrolled (subset of Counseling In Progress, shown for reference)
  // - Admission Confirmed = status ENROLLED
  const [
    totalLeads,
    newClassificationLeads,
    counselingInProgressLeads,
    priorityLeads,
    admissionConfirmedLeads,
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
    prisma.lead.count({ where: { status: 'NEW' } }),
    prisma.lead.count({ where: { status: { notIn: ['NEW', 'ENROLLED'] } } }),
    prisma.lead.count({ where: { classification: 'PRIORITY', status: { not: 'ENROLLED' } } }),
    prisma.lead.count({ where: { status: 'ENROLLED' } }),
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
        classification: { new: newClassificationLeads, counselingInProgress: counselingInProgressLeads, priority: priorityLeads, admissionConfirmed: admissionConfirmedLeads },
        assignment: { auto: autoAssigned, manual: manuallyAssigned, unassigned },
        enrolled
      },
      counselors: { total: totalCounselors, active: activeCounselors, inactive: inactiveCounselors },
      recent: { leads: recentLeads, activity: recentActivity },
      topCounselors
    }
  });
}));

// @route   GET /api/admin/analytics/leads-by-source
// @desc    Leads distribution by source (for Admin Leads page pie chart)
// @access  Private (Admin)
const LEAD_SOURCE_KEYS = ['instagram_ads', 'facebook_ads', 'website', 'whatsapp_direct', 'referral', 'manual_entry'];
router.get('/analytics/leads-by-source', asyncHandler(async (req, res) => {
  const map = {};
  LEAD_SOURCE_KEYS.forEach((k) => { map[k] = 0; });
  map.unknown = 0; // leads with null/unknown source (e.g. created before tracking)
  try {
    const groups = await prisma.lead.groupBy({
      by: ['source'],
      _count: { id: true },
    });
    groups.forEach((g) => {
      if (g.source == null || g.source === undefined) {
        map.unknown += g._count.id;
      } else if (LEAD_SOURCE_KEYS.includes(g.source)) {
        map[g.source] = g._count.id;
      } else {
        map.unknown += g._count.id;
      }
    });
  } catch (_) {
    // source column may not exist yet (migration not applied); return zeros
  }
  res.json({
    success: true,
    data: { ...map },
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
const DEFAULT_CREATE_LEAD_FORM_FIELDS = {
  parentName: true, parentMobile: true, parentEmail: true, parentCity: true,
  preferredLanguage: true, studentName: true, dateOfBirth: true, gender: true,
  currentClass: true, boardUniversity: true, marksPercentage: true,
  institution: true, course: true, academicYear: true, preferredCounselingMode: true, notes: true,
  // UI-only controls for admin lead form
  previousSchooling: true, // toggle field
  academicSection: true,   // Academic Details section
  customFields: [],
  requiredFields: {}, // Admin configures required per field in Settings
  // Dropdown options for core lead fields (editable from Settings)
  dropdownOptions: {
    preferredLanguage: ['English', 'Hindi', 'Kannada', 'Telugu', 'Marathi', 'Tamil', 'Other'],
    preferredCounselingMode: ['Online', 'Offline'],
  },
};

// Default dynamic lead form configuration (sections + fields metadata).
// This is additive: it does NOT change existing lead APIs or database columns.
const DEFAULT_LEAD_FORM_CONFIG = {
  sections: [
    {
      id: 'parentDetails',
      name: 'Parent Details',
      order: 1,
      fields: [
        { id: 'parentName', name: 'parentName', label: 'Parent Name', type: 'text', required: true, visible: true, order: 1 },
        { id: 'parentMobile', name: 'parentMobile', label: 'Mobile Number', type: 'phone', required: true, visible: true, order: 2 },
        { id: 'parentEmail', name: 'parentEmail', label: 'Email', type: 'email', required: true, visible: true, order: 3 },
        { id: 'parentCity', name: 'parentCity', label: 'City', type: 'text', required: true, visible: true, order: 4 },
        { id: 'preferredLanguage', name: 'preferredLanguage', label: 'Preferred Language', type: 'dropdown', required: true, visible: true, order: 5, options: ['English', 'Hindi', 'Kannada', 'Telugu', 'Marathi', 'Tamil', 'Other'] },
      ],
    },
    {
      id: 'studentDetails',
      name: 'Student Details',
      order: 2,
      fields: [
        { id: 'studentName', name: 'studentName', label: 'Student Name', type: 'text', required: true, visible: true, order: 1 },
        { id: 'dateOfBirth', name: 'dateOfBirth', label: 'Date of Birth', type: 'date', required: true, visible: true, order: 2 },
        { id: 'gender', name: 'gender', label: 'Gender', type: 'dropdown', required: true, visible: true, order: 3, options: ['Male', 'Female', 'Other'] },
        { id: 'previousSchooling', name: 'previousSchooling', label: 'Previous Schooling', type: 'toggle', required: false, visible: true, order: 4 },
      ],
    },
    {
      id: 'academicDetails',
      name: 'Academic Details',
      order: 3,
      fields: [
        // Maps to Lead.currentClass in DB
        { id: 'currentClass', name: 'currentClass', label: 'Previously Completed Class', type: 'text', required: false, visible: true, order: 1, dependsOnToggle: 'previousSchooling' },
        // Stored in Lead.customData.previousSchoolName
        { id: 'previousSchoolName', name: 'previousSchoolName', label: 'Previous School Name', type: 'text', required: false, visible: true, order: 2, dependsOnToggle: 'previousSchooling', storage: 'custom' },
        // Maps to Lead.boardUniversity
        { id: 'boardUniversity', name: 'boardUniversity', label: 'Previous Board / Curriculum', type: 'text', required: false, visible: true, order: 3, dependsOnToggle: 'previousSchooling' },
        // Maps to Lead.marksPercentage
        { id: 'marksPercentage', name: 'marksPercentage', label: 'Previous Marks / Percentage', type: 'number', required: false, visible: true, order: 4, dependsOnToggle: 'previousSchooling' },
      ],
    },
    {
      id: 'admissionPreferences',
      name: 'Admission Preferences',
      order: 4,
      fields: [
        // Maps to Lead.courseId via existing Course / Program dropdown
        { id: 'course', name: 'course', label: 'Course / Program', type: 'dropdown', required: false, visible: true, order: 1, optionsFrom: 'courses' },
        { id: 'academicYear', name: 'academicYear', label: 'Academic Year', type: 'text', required: false, visible: true, order: 2 },
      ],
    },
    {
      id: 'counselingInfo',
      name: 'Counseling Information',
      order: 5,
      fields: [
        { id: 'preferredCounselingMode', name: 'preferredCounselingMode', label: 'Preferred Counseling Mode', type: 'dropdown', required: false, visible: true, order: 1, options: ['Online', 'Offline'] },
      ],
    },
    {
      id: 'additionalNotes',
      name: 'Additional Notes',
      order: 6,
      fields: [
        { id: 'notes', name: 'notes', label: 'Notes', type: 'textarea', required: false, visible: true, order: 1 },
      ],
    },
  ],
};

const SETTING_KEYS = [
  { key: 'counselorFields', default: DEFAULT_COUNSELOR_FIELDS },
  { key: 'institutionFields', default: DEFAULT_INSTITUTION_FIELDS },
  { key: 'courseFields', default: DEFAULT_COURSE_FIELDS },
  { key: 'schoolCourseFields', default: DEFAULT_SCHOOL_COURSE_FIELDS },
  { key: 'schoolFields', default: DEFAULT_SCHOOL_FIELDS },
  { key: 'admissionFormFields', default: DEFAULT_ADMISSION_FORM_FIELDS },
  { key: 'createLeadFormFields', default: DEFAULT_CREATE_LEAD_FORM_FIELDS },
  { key: 'leadFormConfig', default: DEFAULT_LEAD_FORM_CONFIG },
];

async function getFormFieldSettings() {
  const result = {
    counselorFields: { ...DEFAULT_COUNSELOR_FIELDS },
    institutionFields: { ...DEFAULT_INSTITUTION_FIELDS },
    courseFields: { ...DEFAULT_COURSE_FIELDS },
    schoolCourseFields: { ...DEFAULT_SCHOOL_COURSE_FIELDS },
    schoolFields: { ...DEFAULT_SCHOOL_FIELDS },
    admissionFormFields: { ...DEFAULT_ADMISSION_FORM_FIELDS },
    createLeadFormFields: { ...DEFAULT_CREATE_LEAD_FORM_FIELDS },
    leadFormConfig: { ...DEFAULT_LEAD_FORM_CONFIG },
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
  const system = await getSystemSettings();
  res.json({
    success: true,
    data: {
      ...data,
      leadAssignmentMode: system.leadAssignmentMode,
    }
  });
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
  body('createLeadFormFields').optional().isObject(),
  body('leadFormConfig').optional().isObject(),
  body('leadAssignmentMode').optional().isIn(['language', 'round_robin', 'skill', 'performance']),
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
    createLeadFormFields: req.body.createLeadFormFields,
    leadFormConfig: req.body.leadFormConfig,
  };

  // System settings update (separate table from app_settings)
  if (req.body.leadAssignmentMode) {
    const current = await getSystemSettings();
    await prisma.systemSettings.update({
      where: { id: current.id },
      data: { leadAssignmentMode: req.body.leadAssignmentMode },
    });
  }

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
  const system = await getSystemSettings();
  res.json({
    success: true,
    message: 'Settings updated',
    data: {
      ...data,
      leadAssignmentMode: system.leadAssignmentMode,
    }
  });
}));

export { getFormFieldSettings };

// @route   GET /api/admin/alerts
// @desc    Get admin alerts (for Admin Dashboard alerts panel)
// @access  Private (Admin)
router.get('/alerts', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const alerts = await prisma.adminAlert.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json({ success: true, data: { alerts } });
}));

// @route   POST /api/admin/alerts/:id/resolve
// @desc    Resolve an alert
// @access  Private (Admin)
router.post('/alerts/:id/resolve', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const alert = await prisma.adminAlert.findUnique({ where: { id } });
  if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });
  await prisma.adminAlert.update({
    where: { id },
    data: { resolvedAt: new Date() },
  });
  res.json({ success: true, message: 'Alert resolved' });
}));

export default router;
