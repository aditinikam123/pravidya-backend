import express from 'express';
import { body, validationResult, query } from 'express-validator';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';
import assignmentEngine from '../services/assignmentEngine.js';
import {
  validateHeaders,
  previewImport,
  executeImport,
  buildErrorReportExcel,
} from '../services/leadImportService.js';

const router = express.Router();

// Helper: generate next leadId (LEAD-YYYYMMDD-NNNN)
async function getNextLeadId() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `LEAD-${dateStr}-`;
  const todayLeads = await prisma.lead.findMany({
    where: { leadId: { startsWith: prefix } },
    select: { leadId: true },
  });
  let maxSeq = 0;
  for (const l of todayLeads) {
    const num = parseInt(l.leadId?.slice(prefix.length) || '0', 10);
    if (!isNaN(num)) maxSeq = Math.max(maxSeq, num);
  }
  return `LEAD-${dateStr}-${String(maxSeq + 1).padStart(4, '0')}`;
}

// @route   POST /api/leads/simple
// @desc    Create lead from external forms (e.g. Trinity College enquiry) - simplified payload
// @access  Public
router.post('/simple', [
  body('student_name').trim().notEmpty().withMessage('Student name is required'),
  body('parent_name').trim().notEmpty().withMessage('Parent name is required'),
  body('student_phone').trim().notEmpty().withMessage('Student phone is required'),
  body('college').trim().notEmpty().withMessage('College is required'),
  body('city_state').trim().notEmpty().withMessage('City/State is required'),
  body('parent_phone').trim().optional(),
  body('email').trim().optional(),
  body('course').trim().optional(),
  body('message').trim().optional(),
  body('source').trim().optional()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const first = errors.array()[0];
    return res.status(400).json({
      success: false,
      message: first?.msg || 'Validation failed',
      errors: errors.array()
    });
  }

  const { student_name, parent_name, student_phone, parent_phone, email, course, college, city_state, message, source } = req.body;
  const phone = (parent_phone && parent_phone.trim()) ? parent_phone.trim() : student_phone.trim();
  const emailVal = (email && email.trim()) ? email.trim() : 'noreply@trinity-enquiry.local';

  // Resolve institution by college name (Trinity College - Main Campus, Trinity College of Engineering, etc.)
  let institution = await prisma.institution.findFirst({
    where: {
      name: { equals: college.trim(), mode: 'insensitive' },
      isActive: true
    },
    include: { courses: { where: { isActive: true } } }
  });
  if (!institution) {
    const normalizedSearch = college.trim().toLowerCase();
    const allInstitutions = await prisma.institution.findMany({
      where: { isActive: true },
      include: { courses: { where: { isActive: true } } }
    });
    institution = allInstitutions.find(
      (inst) => inst.name.toLowerCase().includes(normalizedSearch) || normalizedSearch.includes(inst.name.toLowerCase())
    ) || allInstitutions.find((inst) => inst.name.toLowerCase().includes('trinity'));
  }
  if (!institution) {
    return res.status(400).json({
      success: false,
      message: `College "${college}" not found. Please add it in Pravidya Admin → Institutions first.`
    });
  }

  let courseId = null;
  let importedCourseName = null;
  if (course && course.trim()) {
    const trimmedCourse = course.trim();
    const courseMatch = institution.courses?.find((c) => c.name.toLowerCase() === trimmedCourse.toLowerCase());
    if (courseMatch) {
      courseId = courseMatch.id;
    } else {
      importedCourseName = trimmedCourse;
    }
  }

  const leadId = await getNextLeadId();
  const currentYear = String(new Date().getFullYear());
  const notes = [message || '', source ? `Source: ${source}` : ''].filter(Boolean).join(' | ') || null;

  const leadData = {
    leadId,
    parentName: parent_name.trim(),
    parentMobile: phone,
    parentEmail: emailVal,
    parentCity: city_state.trim(),
    preferredLanguage: 'English',
    studentName: student_name.trim(),
    dateOfBirth: new Date('2000-01-01'),
    gender: 'Other',
    currentClass: importedCourseName || course?.trim() || 'Enquiry',
    boardUniversity: null,
    marksPercentage: null,
    institutionId: institution.id,
    courseId,
    importedCourseName: importedCourseName || null,
    academicYear: currentYear,
    preferredCounselingMode: null,
    notes,
    consent: true,
    classification: 'RAW',
    priority: 'NORMAL',
    status: 'NEW',
    leadSource: source || 'Trinity College Admission Enquiry'
  };

  const lead = await prisma.lead.create({ data: leadData });

  // Try auto-assignment (optional; won't fail if no counselors)
  try {
    const assignmentResult = await assignmentEngine.findBestCounselor(lead);
    if (assignmentResult?.counselorId) {
      await assignmentEngine.assignLead(lead, assignmentResult);
    }
  } catch (_) {
    // Leave unassigned if assignment fails
  }

  res.status(201).json({
    success: true,
    message: 'Enquiry submitted successfully',
    data: { leadId: lead.leadId }
  });
}));

// In‑memory Excel upload handler (for small admin imports)
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const isXlsx =
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname.toLowerCase().endsWith('.xlsx');
    if (!isXlsx) {
      return cb(new Error('Only .xlsx Excel files are allowed'));
    }
    cb(null, true);
  },
});

// @route   POST /api/leads
// @desc    Create public admission form submission
// @access  Public
router.post('/', [
  body('parentName').trim().notEmpty().withMessage('Parent name is required'),
  body('parentMobile').trim().notEmpty().withMessage('Mobile number is required'),
  body('parentEmail').isEmail().withMessage('Valid email is required'),
  body('parentCity').trim().notEmpty().withMessage('City is required'),
  body('preferredLanguage').trim().notEmpty().withMessage('Preferred language is required'),
  body('studentName').trim().notEmpty().withMessage('Student name is required'),
  body('dateOfBirth').isISO8601().withMessage('Valid date of birth is required'),
  body('gender').isIn(['Male', 'Female', 'Other']).withMessage('Gender is required'),
  body('currentClass').trim().notEmpty().withMessage('Current class is required'),
  body('institution').notEmpty().withMessage('Institution is required'),
  body('course').notEmpty().withMessage('Course is required'),
  body('academicYear').trim().notEmpty().withMessage('Academic year is required'),
  body('preferredCounselingMode').isIn(['Online', 'Offline']).withMessage('Counseling mode is required'),
  body('consent').equals('true').withMessage('Consent is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  // Generate leadId in format LEAD-YYYYMMDD-NNNN (same as import)
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `LEAD-${dateStr}-`;
  const todayLeads = await prisma.lead.findMany({
    where: { leadId: { startsWith: prefix } },
    select: { leadId: true },
  });
  let maxSeq = 0;
  for (const l of todayLeads) {
    const num = parseInt(l.leadId?.slice(prefix.length) || '0', 10);
    if (!isNaN(num)) maxSeq = Math.max(maxSeq, num);
  }
  const nextSequence = maxSeq + 1;
  const leadId = `LEAD-${dateStr}-${String(nextSequence).padStart(4, '0')}`;

  // Map frontend field names to database field names
  const leadData = {
    leadId,
    parentName: req.body.parentName,
    parentMobile: req.body.parentMobile,
    parentEmail: req.body.parentEmail,
    parentCity: req.body.parentCity,
    preferredLanguage: req.body.preferredLanguage,
    studentName: req.body.studentName,
    dateOfBirth: new Date(req.body.dateOfBirth),
    gender: req.body.gender,
    currentClass: req.body.currentClass,
    boardUniversity: req.body.boardUniversity || null,
    marksPercentage: req.body.marksPercentage ? parseFloat(req.body.marksPercentage) : null,
    institutionId: req.body.institution,
    courseId: req.body.course,
    academicYear: req.body.academicYear,
    preferredCounselingMode: req.body.preferredCounselingMode,
    notes: req.body.notes || null,
    consent: req.body.consent === 'true' || req.body.consent === true,
    classification: 'RAW',
    priority: 'NORMAL',
    status: 'NEW'
  };

  // Create lead
  const lead = await prisma.lead.create({
    data: leadData
  });

  // Automatic counselor assignment
  const assignmentResult = await assignmentEngine.findBestCounselor(lead);
  await assignmentEngine.assignLead(lead, assignmentResult);

  // Reload lead with populated fields
  const savedLead = await prisma.lead.findUnique({
    where: { id: lead.id },
    include: {
      institution: {
        select: { name: true, type: true }
      },
      course: {
        select: { name: true, code: true }
      },
      assignedCounselor: {
        select: { fullName: true, mobile: true }
      }
    }
  });

  res.status(201).json({
    success: true,
    message: 'Admission form submitted successfully',
    data: {
      lead: savedLead,
      leadId: savedLead.leadId
    }
  });
}));

// @route   GET /api/leads/export-template
// @desc    Download Excel template for lead import (headers only)
// @access  Private (Admin)
router.get(
  '/export-template',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Leads Template');

    // Required: studentName, parentName, parentPhone, institution, course
    // Optional: parentEmail, studentGrade, preferredLanguage, location, notes
    worksheet.columns = [
      { header: 'studentName', key: 'studentName', width: 25 },
      { header: 'parentName', key: 'parentName', width: 25 },
      { header: 'parentPhone', key: 'parentPhone', width: 18 },
      { header: 'institution', key: 'institution', width: 30 },
      { header: 'course', key: 'course', width: 30 },
      { header: 'parentEmail', key: 'parentEmail', width: 30 },
      { header: 'studentGrade', key: 'studentGrade', width: 18 },
      { header: 'preferredLanguage', key: 'preferredLanguage', width: 20 },
      { header: 'location', key: 'location', width: 20 },
      { header: 'notes', key: 'notes', width: 30 },
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="lead_import_template.xlsx"',
    );

    await workbook.xlsx.write(res);
    res.end();
  }),
);

// @route   POST /api/leads/import/preview
// @desc    Validate file and return row errors, duplicates, warnings (no DB write)
// @access  Private (Admin)
router.post(
  '/import/preview',
  authenticate,
  authorize('ADMIN'),
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return res.status(400).json({ success: false, message: 'Excel file is empty or invalid' });
    }

    const headerResult = validateHeaders(worksheet);
    if (!headerResult.valid) {
      return res.status(400).json({
        success: false,
        phase: 'file_error',
        message: 'Invalid Excel Template',
        missingRequired: headerResult.missingRequired,
        unknownColumns: headerResult.unknownColumns,
      });
    }

    const preview = await previewImport(worksheet, headerResult.headerMap);
    res.json({
      success: true,
      phase: 'preview',
      ...preview,
    });
  }),
);

// @route   POST /api/leads/import/execute
// @desc    Run import with duplicate decisions
// @access  Private (Admin)
router.post(
  '/import/execute',
  authenticate,
  authorize('ADMIN'),
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const duplicateDecisions = typeof req.body.duplicateDecisions === 'string'
      ? JSON.parse(req.body.duplicateDecisions || '{}')
      : req.body.duplicateDecisions || {};

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return res.status(400).json({ success: false, message: 'Excel file is empty or invalid' });
    }

    const headerResult = validateHeaders(worksheet);
    if (!headerResult.valid) {
      return res.status(400).json({
        success: false,
        phase: 'file_error',
        message: 'Invalid Excel Template',
        missingRequired: headerResult.missingRequired,
        unknownColumns: headerResult.unknownColumns,
      });
    }

    const result = await executeImport(worksheet, headerResult.headerMap, duplicateDecisions);
    res.json({
      success: true,
      phase: 'complete',
      ...result,
    });
  }),
);

// @route   POST /api/leads/import/error-report
// @desc    Generate and download error report Excel from errorReportRows
// @access  Private (Admin)
router.post(
  '/import/error-report',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const errorReportRows = Array.isArray(req.body?.errorReportRows) ? req.body.errorReportRows : [];
    const buffer = await buildErrorReportExcel(errorReportRows || []);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="lead_import_error_report.xlsx"',
    );
    res.send(Buffer.from(buffer));
  }),
);

// @route   GET /api/leads
// @desc    Get all leads (Admin only)
// @access  Private (Admin)
router.get('/', authenticate, authorize('ADMIN'), [
  query('classification').optional().isIn(['RAW', 'VERIFIED', 'PRIORITY']),
  query('priority').optional().isIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
  query('status').optional().isIn(['NEW', 'CONTACTED', 'FOLLOW_UP', 'ENROLLED', 'REJECTED', 'ON_HOLD']),
  query('assigned').optional().isIn(['true', 'false']),
  query('autoAssigned').optional().isIn(['true', 'false']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], asyncHandler(async (req, res) => {
  const {
    classification,
    priority,
    status,
    assigned,
    autoAssigned,
    page = 1,
    limit = 20,
    search
  } = req.query;

  const where = {};

  if (classification) where.classification = classification;
  if (priority) where.priority = priority;
  if (status) where.status = status;
  if (assigned === 'true') where.assignedCounselorId = { not: null };
  if (assigned === 'false') where.assignedCounselorId = null;
  if (autoAssigned === 'true') where.autoAssigned = true;
  if (autoAssigned === 'false') where.autoAssigned = false;

  if (search) {
    // Optimize: Prioritize direct field searches (faster) over relation searches
    where.OR = [
      { leadId: { contains: search, mode: 'insensitive' } },
      { studentName: { contains: search, mode: 'insensitive' } },
      { parentName: { contains: search, mode: 'insensitive' } },
      { parentMobile: { contains: search, mode: 'insensitive' } },
      { parentEmail: { contains: search, mode: 'insensitive' } },
      // Relation searches are slower - only if direct fields don't match
      { course: { name: { contains: search, mode: 'insensitive' } } },
      { institution: { name: { contains: search, mode: 'insensitive' } } },
      { assignedCounselor: { fullName: { contains: search, mode: 'insensitive' } } }
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Optimize: Use select to fetch only needed fields, reduce data transfer
  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      select: {
        id: true,
        leadId: true,
        studentName: true,
        parentName: true,
        parentMobile: true,
        parentEmail: true,
        currentClass: true,
        status: true,
        classification: true,
        priority: true,
        autoAssigned: true,
        submittedAt: true,
        importedCourseName: true,
        institution: {
          select: { name: true, type: true }
        },
        course: {
          select: { name: true, code: true }
        },
        assignedCounselor: {
          select: { fullName: true, mobile: true }
          // Removed expertise and languages - not displayed in list view
        }
      },
      orderBy: { submittedAt: 'desc' },
      skip,
      take: parseInt(limit)
    }),
    prisma.lead.count({ where })
  ]);

  const totalPages = Math.ceil(total / parseInt(limit));
  res.json({
    success: true,
    data: {
      leads,
      total,
      page: parseInt(page),
      totalPages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: totalPages
      }
    }
  });
}));

// @route   GET /api/leads/export
// @desc    Export existing leads to Excel (supports filters)
// @access  Private (Admin)
router.get(
  '/export',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { startDate, endDate, schoolId, counselorEmail } = req.query;

    const where = {};

    // Date range filter on submittedAt
    if (startDate || endDate) {
      where.submittedAt = {};
      if (startDate) {
        where.submittedAt.gte = new Date(startDate);
      }
      if (endDate) {
        // include end of the day
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.submittedAt.lte = end;
      }
    }

    // Filter by institution / school (institutionId here)
    if (schoolId) {
      where.institutionId = schoolId;
    }

    // Filter by counselor email
    if (counselorEmail) {
      const counselorUser = await prisma.user.findUnique({
        where: { email: counselorEmail },
        include: { counselorProfile: true },
      });
      if (counselorUser?.counselorProfile) {
        where.assignedCounselorId = counselorUser.counselorProfile.id;
      } else {
        // No counselor found, return empty Excel
        where.assignedCounselorId = '__no_such_id__';
      }
    }

    const leads = await prisma.lead.findMany({
      where,
      include: {
        institution: { select: { name: true } },
        course: { select: { name: true } },
        assignedCounselor: {
          select: {
            fullName: true,
            user: { select: { email: true } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Leads');

    worksheet.columns = [
      { header: 'lead_id', key: 'lead_id', width: 24 },
      { header: 'lead_name', key: 'lead_name', width: 25 },
      { header: 'parent_name', key: 'parent_name', width: 25 },
      { header: 'phone_number', key: 'phone_number', width: 18 },
      { header: 'email', key: 'email', width: 30 },
      { header: 'student_class', key: 'student_class', width: 18 },
      { header: 'interested_school', key: 'interested_school', width: 30 },
      { header: 'city', key: 'city', width: 18 },
      { header: 'source', key: 'source', width: 18 },
      {
        header: 'assigned_counselor_email',
        key: 'assigned_counselor_email',
        width: 30,
      },
      { header: 'status', key: 'status', width: 16 },
      { header: 'submitted_at', key: 'submitted_at', width: 24 },
    ];

    leads.forEach((lead) => {
      worksheet.addRow({
        lead_id: lead.leadId,
        lead_name: lead.studentName,
        parent_name: lead.parentName,
        phone_number: lead.parentMobile,
        email: lead.parentEmail,
        student_class: lead.currentClass,
        interested_school: lead.institution?.name || '',
        city: lead.parentCity,
        source: lead.notes || '', // using notes as a generic source field if needed
        assigned_counselor_email:
          lead.assignedCounselor?.user?.email || '',
        status: lead.status,
        submitted_at: lead.submittedAt,
      });
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=\"leads_export.xlsx\"',
    );

    await workbook.xlsx.write(res);
    res.end();
  }),
);

// @route   GET /api/leads/search
// @desc    Global search across all lead fields (Admin only)
// @access  Private (Admin)
router.get('/search', authenticate, authorize('ADMIN'), [
  query('q').trim().notEmpty().withMessage('Search query is required'),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { q, page = 1, limit = 20 } = req.query;
  const searchQuery = q.trim();

  // Build comprehensive search across all lead fields
  const where = {
    OR: [
      // Direct lead fields
      { leadId: { contains: searchQuery, mode: 'insensitive' } },
      { studentName: { contains: searchQuery, mode: 'insensitive' } },
      { parentName: { contains: searchQuery, mode: 'insensitive' } },
      { parentMobile: { contains: searchQuery, mode: 'insensitive' } },
      { parentEmail: { contains: searchQuery, mode: 'insensitive' } },
      // Related fields via joins
      { course: { name: { contains: searchQuery, mode: 'insensitive' } } },
      { institution: { name: { contains: searchQuery, mode: 'insensitive' } } },
      { assignedCounselor: { fullName: { contains: searchQuery, mode: 'insensitive' } } }
    ]
  };

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      select: {
        id: true,
        leadId: true,
        studentName: true,
        parentName: true,
        parentMobile: true,
        parentEmail: true,
        currentClass: true,
        status: true,
        submittedAt: true,
        importedCourseName: true,
        institution: { select: { name: true, type: true } },
        course: { select: { name: true, code: true } },
        assignedCounselor: { select: { fullName: true, mobile: true } }
      },
      orderBy: { submittedAt: 'desc' },
      skip,
      take: parseInt(limit)
    }),
    prisma.lead.count({ where })
  ]);

  const totalPages = Math.ceil(total / parseInt(limit));
  res.json({
    success: true,
    data: {
      leads,
      total,
      page: parseInt(page),
      totalPages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: totalPages
      },
      query: searchQuery
    }
  });
}));

// @route   GET /api/leads/:id
// @desc    Get single lead
// @access  Private (Admin or assigned Counselor)
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: {
      institution: {
        select: { name: true, type: true }
      },
      course: {
        select: { name: true, code: true, description: true }
      },
      assignedCounselor: {
        select: { fullName: true, mobile: true, expertise: true, languages: true }
      }
    }
  });

  if (!lead) {
    return res.status(404).json({
      success: false,
      message: 'Lead not found'
    });
  }

  // Check if user has access
  if (req.user.role === 'COUNSELOR') {
    const counselorProfile = await prisma.counselorProfile.findUnique({
      where: { userId: req.userId }
    });
    if (!counselorProfile || lead.assignedCounselorId !== counselorProfile.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This lead is not assigned to you.'
      });
    }
  }

  res.json({
    success: true,
    data: { lead }
  });
}));

// @route   DELETE /api/leads/:id
// @desc    Delete a lead (Admin only)
// @access  Private (Admin)
router.delete('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id }
  });

  if (!lead) {
    return res.status(404).json({
      success: false,
      message: 'Lead not found'
    });
  }

  await prisma.lead.delete({
    where: { id: req.params.id }
  });

  res.json({
    success: true,
    message: 'Lead deleted successfully'
  });
}));

// @route   PUT /api/leads/:id
// @desc    Update lead
// @access  Private (Admin or assigned Counselor)
router.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id }
  });

  if (!lead) {
    return res.status(404).json({
      success: false,
      message: 'Lead not found'
    });
  }

  // Check access
  let updateData = { ...req.body };
  
  // Remove fields that shouldn't be updated
  delete updateData.id;
  delete updateData.leadId;
  delete updateData.submittedAt;
  delete updateData.createdAt;
  delete updateData.updatedAt;
  
  if (req.user.role === 'COUNSELOR') {
    const counselorProfile = await prisma.counselorProfile.findUnique({
      where: { userId: req.userId }
    });
    if (!counselorProfile || lead.assignedCounselorId !== counselorProfile.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    // Counselors can only update status and notes
    const allowedFields = ['status', 'notes'];
    updateData = {};
    if (req.body.status) updateData.status = req.body.status;
    if (req.body.notes !== undefined) updateData.notes = req.body.notes;
  }

  // Map frontend field names to database field names
  if (updateData.institution) {
    updateData.institutionId = updateData.institution;
    delete updateData.institution;
  }
  if (updateData.course) {
    updateData.courseId = updateData.course;
    delete updateData.course;
  }
  if (updateData.assignedCounselor) {
    updateData.assignedCounselorId = updateData.assignedCounselor;
    delete updateData.assignedCounselor;
  }

  // Convert dateOfBirth if provided
  if (updateData.dateOfBirth) {
    updateData.dateOfBirth = new Date(updateData.dateOfBirth);
  }

  // Convert marksPercentage to float if provided
  if (updateData.marksPercentage !== undefined) {
    updateData.marksPercentage = updateData.marksPercentage ? parseFloat(updateData.marksPercentage) : null;
  }

  // Remove undefined values
  Object.keys(updateData).forEach(key => {
    if (updateData[key] === undefined) {
      delete updateData[key];
    }
  });

  // Check if there's anything to update
  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No valid fields to update'
    });
  }

  const updatedLead = await prisma.lead.update({
    where: { id: req.params.id },
    data: updateData,
    include: {
      institution: {
        select: { name: true, type: true }
      },
      course: {
        select: { name: true, code: true }
      },
      assignedCounselor: {
        select: { fullName: true, mobile: true }
      }
    }
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'UPDATE_LEAD',
      entityType: 'LEAD',
      entityId: lead.id,
      details: updateData
    }
  });

  res.json({
    success: true,
    message: 'Lead updated successfully',
    data: { lead: updatedLead }
  });
}));

// @route   GET /api/leads/available-counselors
// @desc    Get available counselors for manual assignment (Admin only)
// @access  Private (Admin)
router.get('/available-counselors', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { language, expertise, excludeCounselorId } = req.query;
  
  const where = {
    availability: 'ACTIVE' // Only show active counselors
  };

  // Exclude specific counselor if provided
  if (excludeCounselorId) {
    where.id = { not: excludeCounselorId };
  }

  // Get all active counselors first, then filter by language/expertise in memory
  // This allows case-insensitive matching
  let counselors = await prisma.counselorProfile.findMany({
    where,
    include: {
      user: {
        select: {
          username: true,
          email: true
        }
      },
      school: {
        select: {
          name: true
        }
      },
      presence: {
        select: {
          status: true,
          lastActivityAt: true
        }
      },
      assignedLeads: {
        select: {
          id: true
        }
      }
    },
    orderBy: [
      { currentLoad: 'asc' },
      { availability: 'asc' }
    ]
  });

  // Filter by language (case-insensitive)
  if (language) {
    const normalizedLanguage = language.trim().toLowerCase();
    counselors = counselors.filter(counselor => {
      if (!counselor.languages || counselor.languages.length === 0) return false;
      return counselor.languages.some(lang => 
        lang && lang.trim().toLowerCase() === normalizedLanguage
      );
    });
  }

  // Filter by expertise (case-insensitive)
  if (expertise) {
    const normalizedExpertise = expertise.trim().toLowerCase();
    counselors = counselors.filter(counselor => {
      if (!counselor.expertise || counselor.expertise.length === 0) return false;
      return counselor.expertise.some(exp => 
        exp && exp.trim().toLowerCase() === normalizedExpertise
      );
    });
  }

  // Format response with availability info
  const formattedCounselors = counselors.map(counselor => ({
    id: counselor.id,
    fullName: counselor.fullName,
    email: counselor.user.email,
    mobile: counselor.mobile,
    expertise: counselor.expertise || [],
    languages: counselor.languages || [],
    availability: counselor.availability,
    presenceStatus: counselor.presence?.status || 'OFFLINE',
    currentLoad: counselor.currentLoad || 0,
    maxCapacity: counselor.maxCapacity || 50,
    loadPercentage: (counselor.maxCapacity || 50) > 0 
      ? Math.round(((counselor.currentLoad || 0) / (counselor.maxCapacity || 50)) * 100) 
      : 0,
    school: counselor.school?.name || null,
    assignedLeads: counselor.assignedLeads?.length || 0,
    lastActivity: counselor.presence?.lastActivityAt || null
  }));

  res.json({
    success: true,
    data: { counselors: formattedCounselors }
  });
}));

// @route   POST /api/leads/import
// @desc    Import leads from Excel (.xlsx) file
// @access  Private (Admin)
router.post(
  '/import',
  authenticate,
  authorize('ADMIN'),
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        formatError: true,
        message: 'No file uploaded.',
      });
    }

    let workbook;
    try {
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
    } catch (err) {
      return res.status(400).json({
        success: false,
        formatError: true,
        message: 'This file is not a valid Excel (.xlsx) file. Please use "Download lead template" and save your file as .xlsx, or check that the file is not corrupted.',
      });
    }

    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      return res.status(400).json({
        success: false,
        formatError: true,
        message: 'This Excel file does not have the correct format to import leads. The file is empty or has no sheet. Please download the lead template and use it.',
      });
    }

    const headerMap = {};
    const headerRow = worksheet.getRow(1);
    if (!headerRow || !headerRow.cellCount) {
      return res.status(400).json({
        success: false,
        formatError: true,
        message: 'This Excel file does not have the correct format to import leads. The first row must contain column headers (e.g. studentName, parentName, parentPhone). Please download the lead template.',
      });
    }
    headerRow.eachCell((cell, colNumber) => {
      const headerValue = cell.value?.toString().trim() || '';
      // Normalize: lowercase, remove spaces/underscores for matching
      const normalized = headerValue.toLowerCase().replace(/[\s_]/g, '');
      headerMap[normalized] = colNumber;
      headerMap[headerValue.toLowerCase()] = colNumber;
    });

    // Support multiple column name formats
    const getHeader = (...names) => {
      for (const name of names) {
        const normalized = name.toLowerCase().replace(/[\s_]/g, '');
        if (headerMap[normalized]) return headerMap[normalized];
        if (headerMap[name.toLowerCase()]) return headerMap[name.toLowerCase()];
      }
      return null;
    };

    const getCellValue = (row, ...names) => {
      const col = getHeader(...names);
      if (!col) return '';
      const cell = row.getCell(col);
      if (!cell || !cell.value) return '';
      const val = cell.value;
      if (typeof val === 'object' && val !== null) {
        if (val.result !== undefined) return String(val.result).trim();
        if (val.richText) return val.richText.map((rt) => rt.text).join('').trim();
        if (val.text) return String(val.text).trim();
        const str = String(val);
        if (str === '[object Object]') return '';
        return str.trim();
      }
      return String(val).trim();
    };

    const requiredHeaders = [
      { new: 'studentname', old: 'student_name', alt: 'lead_name', label: 'studentName' },
      { new: 'parentname', old: 'parent_name', label: 'parentName' },
      { new: 'parentmobile', old: 'parent_mobile', alt: 'phone_number', label: 'parentPhone' },
      { new: 'parentemail', old: 'parent_email', alt: 'email', label: 'parentEmail' },
      { new: 'currentclass', old: 'current_class', alt: 'student_class', label: 'currentClass' },
      { new: 'institutionname', old: 'institution_name', alt: 'interested_school', label: 'institution' },
      { new: 'parentcity', old: 'parent_city', alt: 'city', label: 'parentCity' },
    ];

    const missingHeaders = requiredHeaders.filter(
      (h) => !getHeader(h.new, h.old, h.alt),
    );
    if (missingHeaders.length > 0) {
      const missingList = missingHeaders.map((h) => h.label || h.new).join(', ');
      return res.status(400).json({
        success: false,
        formatError: true,
        message: `This Excel file does not have the correct format to import leads. Missing required columns: ${missingList}. Please download the lead template and use the same column headers.`,
        missingColumns: missingHeaders.map((h) => h.label || h.new),
      });
    }

    const results = {
      totalRows: 0,
      inserted: 0,
      skipped: 0,
      validationErrors: [], // { row, missingFields } or { row, duplicate, message }
    };

    // Duplicate key: same student name + parent name + phone + email (normalized, case-insensitive)
    const duplicateKey = (studentName, parentName, phone, email) =>
      [studentName, parentName, phone, email].map((v) => String(v || '').toLowerCase().trim()).join('\n');

    const existingLeads = await prisma.lead.findMany({
      select: { studentName: true, parentName: true, parentMobile: true, parentEmail: true },
    });
    const seenKeys = new Set(existingLeads.map((l) => duplicateKey(l.studentName, l.parentName, l.parentMobile, l.parentEmail)));

    // Required fields: Course is OPTIONAL (not in this list) - empty course is allowed, no error
    const requiredFieldChecks = [
      { key: 'studentName', label: 'Student Name', getVal: (r) => (getCellValue(r, 'studentname', 'student_name', 'lead_name') || '').trim() },
      { key: 'parentName', label: 'Parent Name', getVal: (r) => (getCellValue(r, 'parentname', 'parent_name') || '').trim() },
      { key: 'phone', label: 'Parent Mobile', getVal: (r) => (getCellValue(r, 'parentmobile', 'parent_mobile', 'phone_number') || '').trim() },
      { key: 'email', label: 'Parent Email', getVal: (r) => (getCellValue(r, 'parentemail', 'parent_email', 'email') || '').trim() },
      { key: 'studentClass', label: 'Current Class', getVal: (r) => (getCellValue(r, 'currentclass', 'current_class', 'student_class') || '').trim() },
      { key: 'institutionName', label: 'Institution Name', getVal: (r) => (getCellValue(r, 'institutionname', 'institution_name', 'interested_school') || '').trim() },
      { key: 'city', label: 'Parent City', getVal: (r) => (getCellValue(r, 'parentcity', 'parent_city', 'city') || '').trim() },
      // Note: Course is NOT required - empty course field is allowed, no validation error
    ];

    const rowsToInsert = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header

      const studentName = (getCellValue(row, 'studentname', 'student_name', 'lead_name') || '').trim();
      const phone = (getCellValue(row, 'parentmobile', 'parent_mobile', 'phone_number') || '').trim();
      const email = (getCellValue(row, 'parentemail', 'parent_email', 'email') || '').trim();

      // Skip completely empty rows (no identity)
      if (!studentName && !phone && !email) return;
      results.totalRows += 1;

      // Check required fields; if any empty, add to validationErrors and skip row
      const missingFields = [];
      for (const { label, getVal } of requiredFieldChecks) {
        const val = getVal(row);
        if (!val || val === '') {
          missingFields.push({ fieldName: label, message: 'This field is empty' });
        }
      }
      if (missingFields.length > 0) {
        results.validationErrors.push({ row: rowNumber, missingFields });
        return;
      }

      const parentName = (getCellValue(row, 'parentname', 'parent_name') || '').trim();

      // Duplicate check: same Student Name + Parent Name + Parent Mobile + Parent Email (in DB or in file)
      const key = duplicateKey(studentName, parentName, phone, email);
      if (seenKeys.has(key)) {
        results.validationErrors.push({
          row: rowNumber,
          duplicate: true,
          message: 'Duplicate lead: same Student Name, Parent Name, Parent Mobile and Parent Email.',
        });
        return;
      }
      seenKeys.add(key);

      const studentClass = (getCellValue(row, 'currentclass', 'current_class', 'student_class') || '').trim();
      const institutionName = (getCellValue(row, 'institutionname', 'institution_name', 'interested_school') || '').trim();
      const city = (getCellValue(row, 'parentcity', 'parent_city', 'city') || '').trim();
      const preferredLanguage = (getCellValue(row, 'preferredlanguage', 'preferred_language') || '').trim() || 'English';
      const dateOfBirth = getCellValue(row, 'dateofbirth', 'date_of_birth');
      const gender = (getCellValue(row, 'gender') || '').trim();
      const boardUniversity = (getCellValue(row, 'boarduniversity', 'board_university') || '').trim() || null;
      const marksPercentage = getCellValue(row, 'markspercentage', 'marks_percentage');
      const courseName = (getCellValue(row, 'coursename', 'course_name', 'course', 'program', 'branch', 'department', 'stream') || '').trim();
      const academicYear = (getCellValue(row, 'academicyear', 'academic_year') || '').trim() || '';
      const preferredCounselingMode = (getCellValue(row, 'preferredcounselingmode', 'preferred_counseling_mode') || '').trim();
      const notes = (getCellValue(row, 'notes', 'source') || '').trim() || null;
      const counselorEmailRaw = getCellValue(row, 'assignedcounseloremail', 'assigned_counselor_email', 'counselor_email');
      const counselorEmail = String(counselorEmailRaw || '').trim();

      rowsToInsert.push({
        rowNumber,
        data: {
          studentName: studentName || '—',
          parentName: parentName || '—',
          phone: phone || '—',
          email: email || '—',
          studentClass: studentClass || '—',
          institutionName: institutionName || '—',
          city: city || '—',
          preferredLanguage,
          dateOfBirth,
          gender,
          boardUniversity,
          marksPercentage,
          courseName,
          academicYear,
          preferredCounselingMode,
          notes,
          counselorEmail,
        },
      });
    });

    // If any row has empty required fields or duplicates, do not insert any leads — return errors only
    if (results.validationErrors.length > 0) {
      const hasMissing = results.validationErrors.some((e) => e.missingFields);
      const hasDuplicate = results.validationErrors.some((e) => e.duplicate);
      let message = 'Import aborted: ';
      if (hasMissing && hasDuplicate) message += 'some rows have missing required fields or are duplicates.';
      else if (hasDuplicate) message += 'some rows are duplicates (same Student Name, Parent Name, Parent Mobile and Parent Email).';
      else message += 'some rows have missing required fields.';
      message += ' Please correct and try again.';
      return res.json({
        success: true,
        message,
        data: {
          inserted: 0,
          skipped: results.totalRows,
          totalRows: results.totalRows,
          validationErrors: results.validationErrors,
        },
      });
    }

    // Process inserts inside a transaction (CRM-style: no duplicate/validation blocks)
    await prisma.$transaction(async (tx) => {
      // Lead ID format: LEAD-YYYYMMDD-NNNN (daily sequence)
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const prefix = `LEAD-${dateStr}-`;
      const todayLeads = await tx.lead.findMany({
        where: { leadId: { startsWith: prefix } },
        select: { leadId: true },
      });
      let maxSeq = 0;
      for (const l of todayLeads) {
        const num = parseInt(l.leadId?.slice(prefix.length) || '0', 10);
        if (!isNaN(num)) maxSeq = Math.max(maxSeq, num);
      }
      let nextSequence = maxSeq + 1;

      for (const row of rowsToInsert) {
        const {
          rowNumber,
          data: {
            studentName,
            parentName,
            phone,
            email,
            studentClass,
            institutionName,
            city,
            preferredLanguage,
            dateOfBirth,
            gender,
            boardUniversity,
            marksPercentage,
            courseName,
            academicYear,
            preferredCounselingMode,
            notes,
            counselorEmail,
          },
        } = row;

        // Resolve institution - flexible matching; if none in DB, skip row (only skip for no institution)
        let institution = await tx.institution.findFirst({
          where: {
            name: { equals: institutionName, mode: 'insensitive' },
            isActive: true,
          },
          include: {
            courses: { where: { isActive: true } },
          },
        });
        if (!institution) {
          const allInstitutions = await tx.institution.findMany({
            where: { isActive: true },
            include: { courses: { where: { isActive: true } } },
          });
          const normalizedSearch = (institutionName || '').toLowerCase();
          institution = allInstitutions.find(
            (inst) =>
              inst.name.toLowerCase().includes(normalizedSearch) ||
              normalizedSearch.includes(inst.name.toLowerCase())
          );
        }
        if (!institution) {
          institution = await tx.institution.findFirst({
            where: { isActive: true },
            include: { courses: { where: { isActive: true } } },
            orderBy: { name: 'asc' },
          });
        }
        if (!institution) {
          results.skipped += 1;
          continue;
        }

        // Course: exact match only (case-insensitive). If not found, store name and show "CSE (course not available)"
        let courseId = null;
        let importedCourseName = null;
        if ((courseName || '').trim()) {
          const trimmedName = courseName.trim();
          const normalizedCourseName = trimmedName.toLowerCase();
          const course = institution.courses.find(
            (c) => c.name.toLowerCase().trim() === normalizedCourseName
          );
          if (course) {
            courseId = course.id;
          } else {
            importedCourseName = trimmedName;
          }
        }

        // Counselor: if email not found set assignedTo = null (do not throw)
        let counselorProfileId = null;
        const counselorEmailStr = String(counselorEmail || '').trim();
        if (counselorEmailStr && counselorEmailStr !== '[object Object]' && counselorEmailStr.includes('@')) {
          try {
            const counselorUser = await tx.user.findUnique({
              where: { email: counselorEmailStr },
              include: { counselorProfile: true },
            });
            if (counselorUser?.counselorProfile) {
              counselorProfileId = counselorUser.counselorProfile.id;
            }
          } catch (_) {}
        }

        let dob = new Date('2000-01-01');
        if (dateOfBirth) {
          const parsedDob = new Date(dateOfBirth);
          if (!isNaN(parsedDob.getTime())) dob = parsedDob;
        }

        // Gender: M/Male → Male, F/Female → Female, other → Other
        const g = (gender || '').toLowerCase();
        let normalizedGender = 'Other';
        if (g === 'm' || g === 'male') normalizedGender = 'Male';
        else if (g === 'f' || g === 'female') normalizedGender = 'Female';

        // Preferred counseling mode: online → Online, offline → Offline, blank → null
        const modeStr = (preferredCounselingMode || '').toLowerCase();
        let normalizedMode = null;
        if (modeStr === 'online') normalizedMode = 'Online';
        else if (modeStr === 'offline') normalizedMode = 'Offline';

        let marks = null;
        if (marksPercentage) {
          const parsed = parseFloat(marksPercentage);
          if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) marks = parsed;
        }

        // Auto-generate leadId in format LEAD-YYYYMMDD-NNNN (daily sequence)
        const leadId = `LEAD-${dateStr}-${String(nextSequence).padStart(4, '0')}`;
        nextSequence += 1;

        const createData = {
          leadId,
          parentName,
          parentMobile: phone,
          parentEmail: email,
          parentCity: city,
          preferredLanguage: preferredLanguage || 'English',
          studentName,
          dateOfBirth: dob,
          gender: normalizedGender,
          currentClass: studentClass,
          boardUniversity: boardUniversity || null,
          marksPercentage: marks,
          institutionId: institution.id,
          academicYear: academicYear || '',
          notes,
          consent: true,
          classification: 'RAW',
          priority: 'NORMAL',
          status: 'NEW',
          autoAssigned: !!counselorProfileId,
          assignedCounselorId: counselorProfileId,
        };
        if (courseId) createData.courseId = courseId;
        if (importedCourseName) createData.importedCourseName = importedCourseName;
        if (normalizedMode) createData.preferredCounselingMode = normalizedMode;

        await tx.lead.create({ data: createData });
        results.inserted += 1;
      }
    });

    results.skipped = Math.max(0, results.totalRows - results.inserted);

    return res.json({
      success: true,
      message: 'Lead import completed',
      data: {
        inserted: results.inserted,
        skipped: results.skipped,
        totalRows: results.totalRows,
        validationErrors: results.validationErrors,
      },
    });
  }),
);

// @route   POST /api/leads/:id/assign
// @desc    Manually assign/reassign counselor (Admin only)
// @access  Private (Admin)
router.post('/:id/assign', authenticate, authorize('ADMIN'), [
  body('counselorId').notEmpty().withMessage('Counselor ID is required'),
  body('reason').trim().optional()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id }
  });

  if (!lead) {
    return res.status(404).json({
      success: false,
      message: 'Lead not found'
    });
  }

  const { counselorId, reason } = req.body;
  await assignmentEngine.reassignLead(lead, counselorId, reason || 'Manual assignment by admin');

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'REASSIGN_LEAD',
      entityType: 'LEAD',
      entityId: lead.id,
      details: { counselorId, reason: reason || 'Manual assignment by admin' }
    }
  });

  const updatedLead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: {
      assignedCounselor: {
        select: { fullName: true, mobile: true, expertise: true }
      }
    }
  });

  res.json({
    success: true,
    message: 'Lead reassigned successfully',
    data: { lead: updatedLead }
  });
}));

// @route   GET /api/leads/stats/overview
// @desc    Get lead statistics (Admin only)
// @access  Private (Admin)
router.get('/stats/overview', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const [
    totalLeads,
    rawLeads,
    verifiedLeads,
    priorityLeads,
    autoAssigned,
    manuallyAssigned,
    unassigned,
    newLeads,
    enrolled
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { classification: 'RAW' } }),
    prisma.lead.count({ where: { classification: 'VERIFIED' } }),
    prisma.lead.count({ where: { classification: 'PRIORITY' } }),
    prisma.lead.count({ where: { autoAssigned: true } }),
    prisma.lead.count({ where: { autoAssigned: false, assignedCounselorId: { not: null } } }),
    prisma.lead.count({ where: { assignedCounselorId: null } }),
    prisma.lead.count({ where: { status: 'NEW' } }),
    prisma.lead.count({ where: { status: 'ENROLLED' } })
  ]);

  // Recent leads (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentLeads = await prisma.lead.count({
    where: {
      submittedAt: { gte: sevenDaysAgo }
    }
  });

  res.json({
    success: true,
    data: {
      total: totalLeads,
      classification: {
        raw: rawLeads,
        verified: verifiedLeads,
        priority: priorityLeads
      },
      assignment: {
        auto: autoAssigned,
        manual: manuallyAssigned,
        unassigned
      },
      status: {
        new: newLeads,
        enrolled
      },
      recent: recentLeads
    }
  });
}));

export default router;
