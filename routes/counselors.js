import express from 'express';
import { body, validationResult, query } from 'express-validator';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';
import { hashPassword } from '../utils/password.js';

const router = express.Router();

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

// @route   GET /api/counselors/all
// @desc    Get counselors with full details (for manual assignment; optional pagination)
// @access  Private (Admin)
router.get('/all', authenticate, authorize('ADMIN'), [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 200 })
], asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 0;
    const usePagination = limit > 0;
    const skip = usePagination ? (page - 1) * limit : 0;
    const take = usePagination ? limit : undefined;

    const [counselors, total] = await Promise.all([
      prisma.counselorProfile.findMany({
        skip: usePagination ? skip : 0,
        take,
        select: {
          id: true,
          fullName: true,
          mobile: true,
          schoolId: true,
          expertise: true,
          languages: true,
          availability: true,
          currentLoad: true,
          maxCapacity: true,
          user: { select: { username: true, email: true, isActive: true } },
          school: { select: { id: true, name: true } },
          presence: { select: { status: true, lastActivityAt: true, lastLoginAt: true } },
          assignedLeads: { select: { id: true } }
        },
        orderBy: [
          { availability: 'asc' },
          { currentLoad: 'asc' },
          { fullName: 'asc' }
        ]
      }),
      prisma.counselorProfile.count()
    ]);

    // Format response with all details
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
      schoolId: counselor.schoolId,
      assignedLeads: counselor.assignedLeads?.length || 0,
      lastActivity: counselor.presence?.lastActivityAt || null,
      lastLogin: counselor.presence?.lastLoginAt || null
    }));

    res.json({
      success: true,
      data: {
        counselors: formattedCounselors,
        ...(usePagination && { total, page, totalPages: Math.ceil(total / limit) })
      }
    });
  } catch (error) {
    console.error('❌ Error fetching counselors:', error);
    
    // Check if it's a database connection error
    if (error.message && (
      error.message.includes('Can\'t reach database') ||
      error.message.includes('connection') ||
      error.code === 'P1001' ||
      error.message.includes('TLS connection')
    )) {
      return res.status(503).json({
        success: false,
        message: 'Database connection error. Please ensure the database is active and accessible.',
        error: 'Database server unreachable. Check if Neon database is paused or connection string is correct.',
        details: 'Go to https://console.neon.tech and ensure your database is active (not paused).'
      });
    }
    
    throw error; // Re-throw for asyncHandler to handle
  }
}));

// @route   GET /api/counselors/export-template
// @desc    Download Excel template for counselor import (headers only)
// @access  Private (Admin)
router.get(
  '/export-template',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Counselors Template');

    worksheet.columns = [
      { header: 'full_name', key: 'full_name', width: 25 },
      { header: 'email', key: 'email', width: 30 },
      { header: 'phone_number', key: 'phone_number', width: 18 },
      { header: 'assigned_school', key: 'assigned_school', width: 30 },
      { header: 'role', key: 'role', width: 16 },
    ];

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=\"counselor_import_template.xlsx\"',
    );

    await workbook.xlsx.write(res);
    res.end();
  }),
);

// @route   GET /api/counselors/debug
// @desc    Debug endpoint to see all counselors and their data
// @access  Private (Admin)
router.get('/debug', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const allCounselors = await prisma.counselorProfile.findMany({
    include: {
      user: {
        select: {
          username: true,
          email: true
        }
      }
    }
  });

  res.json({
    success: true,
    data: {
      total: allCounselors.length,
      counselors: allCounselors.map(c => ({
        id: c.id,
        fullName: c.fullName,
        email: c.user.email,
        languages: c.languages,
        expertise: c.expertise,
        availability: c.availability,
        currentLoad: c.currentLoad,
        maxCapacity: c.maxCapacity
      }))
    }
  });
}));

// @route   GET /api/counselors/filter
// @desc    Get counselors filtered by language (for manual assignment)
// @access  Private (Admin)
router.get('/filter', authenticate, authorize('ADMIN'), [
  query('language').trim().notEmpty().withMessage('Language is required'),
  query('availability').optional().isIn(['ACTIVE', 'INACTIVE'])
], asyncHandler(async (req, res) => {
  const { language, availability } = req.query;
  
  // Normalize language for case-insensitive matching
  const normalizedLanguage = language.trim();
  
  console.log('🔍 Filtering counselors by language:', normalizedLanguage);
  
  // Build where clause - Get ALL counselors first, filter in memory
  const where = {};

  console.log('📋 Where clause (before availability filter):', JSON.stringify(where));

  // Get ALL counselors first, then filter by availability and language in memory
  // This allows case-insensitive matching and better debugging
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

  console.log(`📊 Found ${counselors.length} counselors before any filters`);
  counselors.forEach(c => {
    console.log(`  - ${c.fullName}: languages=${JSON.stringify(c.languages)}, availability=${c.availability}`);
  });

  // Filter by availability (in memory)
  const requestedAvailability = availability || 'ACTIVE';
  const beforeAvailabilityFilter = counselors.length;
  counselors = counselors.filter(counselor => {
    const matches = counselor.availability === requestedAvailability;
    if (!matches) {
      console.log(`  ⚠️ ${counselor.fullName}: availability=${counselor.availability} doesn't match requested ${requestedAvailability}`);
    }
    return matches;
  });
  console.log(`📊 After availability filter (${requestedAvailability}): ${counselors.length} counselors (was ${beforeAvailabilityFilter})`);

  // Filter by language (case-insensitive)
  if (normalizedLanguage) {
    const languageLower = normalizedLanguage.toLowerCase();
    console.log(`🔎 Filtering for language (case-insensitive): "${languageLower}"`);
    
    const beforeCount = counselors.length;
    counselors = counselors.filter(counselor => {
      if (!counselor.languages || counselor.languages.length === 0) {
        console.log(`  ❌ ${counselor.fullName}: No languages array`);
        return false;
      }
      const hasLanguage = counselor.languages.some(lang => {
        const match = lang && lang.trim().toLowerCase() === languageLower;
        if (match) {
          console.log(`  ✅ ${counselor.fullName}: Found language "${lang}" matches "${normalizedLanguage}"`);
        }
        return match;
      });
      if (!hasLanguage) {
        console.log(`  ❌ ${counselor.fullName}: Languages ${JSON.stringify(counselor.languages)} don't match "${normalizedLanguage}"`);
      }
      return hasLanguage;
    });
    console.log(`📊 After language filter: ${counselors.length} counselors (was ${beforeCount})`);
  }

  // Format response
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

  console.log(`✅ Returning ${formattedCounselors.length} formatted counselors`);

  res.json({
    success: true,
    data: { counselors: formattedCounselors }
  });
}));

// @route   GET /api/counselors
// @desc    Get all counselors (Admin only). ?includeStats=true returns stats in one request (faster).
// @access  Private (Admin)
router.get('/', authenticate, authorize('ADMIN'), [
  query('availability').optional().isIn(['ACTIVE', 'INACTIVE']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 500 }),
  query('search').optional().trim(),
  query('includeStats').optional().isBoolean()
], asyncHandler(async (req, res) => {
  const { availability, page = 1, limit = 20, search, includeStats } = req.query;
  const where = {};

  if (availability) where.availability = availability;
  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { mobile: { contains: search, mode: 'insensitive' } }
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const [counselors, total] = await Promise.all([
    prisma.counselorProfile.findMany({
      where,
      include: {
        user: {
          select: { username: true, email: true, isActive: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    }),
    prisma.counselorProfile.count({ where })
  ]);

  let counselorsWithStats = counselors;
  if (includeStats === 'true' && counselors.length > 0) {
    const ids = counselors.map((c) => c.id);
    const [
      totalByCounselor,
      newByCounselor,
      inProgressByCounselor,
      enrolledByCounselor,
      presenceList,
      trainingTotalByCounselor,
      trainingCompletedByCounselor
    ] = await Promise.all([
      prisma.lead.groupBy({
        by: ['assignedCounselorId'],
        where: { assignedCounselorId: { in: ids } },
        _count: { id: true }
      }),
      prisma.lead.groupBy({
        by: ['assignedCounselorId'],
        where: { assignedCounselorId: { in: ids }, status: 'NEW' },
        _count: { id: true }
      }),
      prisma.lead.groupBy({
        by: ['assignedCounselorId'],
        where: { assignedCounselorId: { in: ids }, status: { in: ['CONTACTED', 'FOLLOW_UP'] } },
        _count: { id: true }
      }),
      prisma.lead.groupBy({
        by: ['assignedCounselorId'],
        where: { assignedCounselorId: { in: ids }, status: 'ENROLLED' },
        _count: { id: true }
      }),
      prisma.counselorPresence.findMany({
        where: { counselorId: { in: ids } }
      }),
      prisma.trainingProgress.groupBy({
        by: ['counselorId'],
        where: { counselorId: { in: ids } },
        _count: { id: true }
      }),
      prisma.trainingProgress.groupBy({
        by: ['counselorId'],
        where: { counselorId: { in: ids }, status: 'COMPLETED' },
        _count: { id: true }
      })
    ]);
    const toMap = (arr, key = 'assignedCounselorId') => {
      const m = {};
      arr.forEach((x) => { m[x[key]] = x._count?.id ?? 0; });
      return m;
    };
    const totalMap = toMap(totalByCounselor);
    const newMap = toMap(newByCounselor);
    const inProgressMap = toMap(inProgressByCounselor);
    const enrolledMap = toMap(enrolledByCounselor);
    const trainingTotalMap = toMap(trainingTotalByCounselor, 'counselorId');
    const trainingCompletedMap = toMap(trainingCompletedByCounselor, 'counselorId');
    const presenceMap = new Map(presenceList.map((p) => [p.counselorId, p]));
    counselorsWithStats = counselors.map((c) => {
      const presence = presenceMap.get(c.id);
      const trainingTotal = trainingTotalMap[c.id] ?? 0;
      const trainingCompleted = trainingCompletedMap[c.id] ?? 0;
      return {
        ...c,
        stats: {
          totalLeads: totalMap[c.id] ?? 0,
          newLeads: newMap[c.id] ?? 0,
          inProgressLeads: inProgressMap[c.id] ?? 0,
          inProgress: inProgressMap[c.id] ?? 0,
          enrolled: enrolledMap[c.id] ?? 0,
          currentLoad: c.currentLoad ?? 0,
          maxCapacity: c.maxCapacity ?? 50,
          loadPercentage: (c.maxCapacity ?? 50) > 0 ? Math.round(((c.currentLoad ?? 0) / (c.maxCapacity ?? 50)) * 100) : 0,
          presenceStatus: presence?.status ?? 'OFFLINE',
          lastLoginAt: presence?.lastLoginAt ?? null,
          lastActivityAt: presence?.lastActivityAt ?? null,
          lastActiveAt: presence?.lastActivityAt ?? null,
          activeMinutesToday: presence?.activeMinutesToday ?? 0,
          totalActiveMinutes: presence?.totalActiveMinutes ?? 0,
          trainingTotal,
          trainingCompleted,
          trainingCompletion: trainingTotal > 0 ? Math.round((trainingCompleted / trainingTotal) * 100) : 0
        }
      };
    });
  }

  res.json({
    success: true,
    data: {
      counselors: counselorsWithStats,
      pagination: {
        page: parseInt(page),
        limit: take,
        total,
        pages: Math.ceil(total / take)
      }
    }
  });
}));

// @route   POST /api/counselors/import
// @desc    Import counselors from Excel (.xlsx) file
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
        message: 'No file uploaded',
      });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      return res.status(400).json({
        success: false,
        message: 'Excel file is empty or invalid',
      });
    }

    const headerMap = {};
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      headerMap[cell.value?.toString().trim().toLowerCase()] = colNumber;
    });

    const requiredHeaders = ['full_name', 'email', 'phone_number'];

    const missingHeaders = requiredHeaders.filter(
      (h) => !headerMap[h],
    );
    if (missingHeaders.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required columns: ${missingHeaders.join(', ')}`,
      });
    }

    const results = {
      totalRows: 0,
      inserted: 0,
      skipped: 0,
      failed: 0,
      errors: [], // { row, message }
    };

    const rowsToInsert = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const firstCell =
        row.getCell(headerMap['full_name']).value ||
        row.getCell(headerMap['email']).value;
      if (!firstCell) return;

      results.totalRows += 1;

      const getCellValue = (header) =>
        row.getCell(headerMap[header])?.value?.toString().trim() || '';

      const fullName = getCellValue('full_name');
      const email = getCellValue('email');
      const phone = getCellValue('phone_number');
      const assignedSchool = headerMap['assigned_school']
        ? getCellValue('assigned_school')
        : '';
      const role =
        headerMap['role'] && getCellValue('role')
          ? getCellValue('role')
          : 'COUNSELOR';

      const rowErrors = [];
      if (!fullName) rowErrors.push('full_name is required');
      if (!email) rowErrors.push('email is required');
      if (!phone) rowErrors.push('phone_number is required');

      const phoneRegex = /^[0-9+\-\s]{7,15}$/;
      if (phone && !phoneRegex.test(phone)) {
        rowErrors.push('phone_number format is invalid');
      }

      if (role.toUpperCase() !== 'COUNSELOR') {
        rowErrors.push('role must be counselor');
      }

      if (rowErrors.length > 0) {
        results.failed += 1;
        results.errors.push({
          row: rowNumber,
          message: rowErrors.join('; '),
        });
        return;
      }

      rowsToInsert.push({
        rowNumber,
        data: { fullName, email, phone, assignedSchool },
      });
    });

    const DEFAULT_PASSWORD = 'Counselor@123';
    const hashedDefaultPassword = await hashPassword(DEFAULT_PASSWORD);

    await prisma.$transaction(async (tx) => {
      for (const row of rowsToInsert) {
        const {
          rowNumber,
          data: { fullName, email, phone, assignedSchool },
        } = row;

        const perRowErrors = [];

        // Skip duplicates by email
        const existingUser = await tx.user.findUnique({
          where: { email },
        });
        if (existingUser) {
          results.skipped += 1;
          results.errors.push({
            row: rowNumber,
            message: 'User with this email already exists, skipping',
          });
          continue;
        }

        // Resolve school by name (optional)
        let schoolId = null;
        if (assignedSchool) {
          const school = await tx.school.findFirst({
            where: {
              name: {
                equals: assignedSchool,
                mode: 'insensitive',
              },
            },
          });
          if (!school) {
            perRowErrors.push(
              `School "${assignedSchool}" not found`,
            );
          } else {
            schoolId = school.id;
          }
        }

        if (perRowErrors.length > 0) {
          results.failed += 1;
          results.errors.push({
            row: rowNumber,
            message: perRowErrors.join('; '),
          });
          continue;
        }

        const user = await tx.user.create({
          data: {
            username: email.split('@')[0],
            email,
            password: hashedDefaultPassword,
            role: 'COUNSELOR',
          },
        });

        await tx.counselorProfile.create({
          data: {
            userId: user.id,
            fullName,
            mobile: phone,
            expertise: [],
            languages: [],
            availability: 'ACTIVE',
            maxCapacity: 50,
            currentLoad: 0,
            schoolId,
          },
        });

        results.inserted += 1;
      }
    });

    return res.json({
      success: true,
      message: 'Counselor import completed',
      data: results,
    });
  }),
);

// @route   GET /api/counselors/:id
// @desc    Get single counselor
// @access  Private (Admin or self)
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const counselor = await prisma.counselorProfile.findUnique({
    where: { id: req.params.id },
    include: {
      user: {
        select: { username: true, email: true, isActive: true }
      },
      assignedLeads: {
        select: { leadId: true, studentName: true, parentName: true, status: true, classification: true }
      }
    }
  });

  if (!counselor) {
    return res.status(404).json({
      success: false,
      message: 'Counselor not found'
    });
  }

  // Check access
  if (req.user.role === 'COUNSELOR') {
    const userCounselor = await prisma.counselorProfile.findUnique({
      where: { userId: req.userId }
    });
    if (!userCounselor || userCounselor.id !== counselor.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
  }

  res.json({
    success: true,
    data: { counselor }
  });
}));

// @route   POST /api/counselors
// @desc    Create counselor (Admin only)
// @access  Private (Admin)
router.post('/', authenticate, authorize('ADMIN'), [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('fullName').trim().notEmpty().withMessage('Full name is required'),
  body('mobile').trim().notEmpty().withMessage('Mobile number is required'),
  body('expertise').isArray().withMessage('Expertise must be an array'),
  body('languages').isArray().withMessage('Languages must be an array')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { username, email, password, fullName, mobile, expertise, languages, availability, maxCapacity, schoolId } = req.body;

  // Check if user already exists
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

  // Create user and counselor profile in a transaction
  const hashedPassword = await hashPassword(password);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role: 'COUNSELOR',
        isActive: true
      }
    });

    const counselorProfile = await tx.counselorProfile.create({
      data: {
        userId: user.id,
        fullName,
        mobile,
        expertise: expertise || [],
        languages: languages || [],
        availability: availability || 'ACTIVE',
        maxCapacity: maxCapacity || 50,
        schoolId: schoolId || null
      },
      include: {
        user: {
          select: { username: true, email: true }
        },
        school: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    return counselorProfile;
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'CREATE_COUNSELOR',
      entityType: 'COUNSELOR',
      entityId: result.id,
      details: { username, email, fullName }
    }
  });

  res.status(201).json({
    success: true,
    message: 'Counselor created successfully',
    data: { counselor: result }
  });
}));

// @route   PUT /api/counselors/:id
// @desc    Update counselor
// @access  Private (Admin)
router.put('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const counselor = await prisma.counselorProfile.findUnique({
    where: { id: req.params.id }
  });

  if (!counselor) {
    return res.status(404).json({
      success: false,
      message: 'Counselor not found'
    });
  }

  const allowedFields = ['fullName', 'mobile', 'expertise', 'languages', 'availability', 'maxCapacity', 'schoolId'];
  const updateData = {};
  Object.keys(req.body).forEach(key => {
    if (allowedFields.includes(key)) {
      updateData[key] = req.body[key];
    }
  });

  const updatedCounselor = await prisma.counselorProfile.update({
    where: { id: req.params.id },
    data: updateData,
    include: {
      user: {
        select: { username: true, email: true }
      },
      school: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'UPDATE_COUNSELOR',
      entityType: 'COUNSELOR',
      entityId: counselor.id,
      details: updateData
    }
  });

  res.json({
    success: true,
    message: 'Counselor updated successfully',
    data: { counselor: updatedCounselor }
  });
}));

// @route   GET /api/counselors/:id/leads
// @desc    Get leads assigned to counselor
// @access  Private (Admin or self)
router.get('/:id/leads', authenticate, asyncHandler(async (req, res) => {
  const counselor = await prisma.counselorProfile.findUnique({
    where: { id: req.params.id }
  });

  if (!counselor) {
    return res.status(404).json({
      success: false,
      message: 'Counselor not found'
    });
  }

  // Check access
  if (req.user.role === 'COUNSELOR') {
    const userCounselor = await prisma.counselorProfile.findUnique({
      where: { userId: req.userId }
    });
    if (!userCounselor || userCounselor.id !== counselor.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
  }

  const leads = await prisma.lead.findMany({
    where: { assignedCounselorId: req.params.id },
    include: {
      institution: {
        select: { name: true, type: true }
      },
      course: {
        select: { name: true, code: true }
      }
    },
    orderBy: { submittedAt: 'desc' }
  });

  res.json({
    success: true,
    data: { leads }
  });
}));

// @route   GET /api/counselors/:id/new-leads-count
// @desc    Lightweight endpoint for new leads count only (for layout/header)
// @access  Private (Admin or self)
router.get('/:id/new-leads-count', authenticate, asyncHandler(async (req, res) => {
  const counselor = await prisma.counselorProfile.findUnique({
    where: { id: req.params.id },
    select: { id: true }
  });

  if (!counselor) {
    return res.status(404).json({ success: false, message: 'Counselor not found' });
  }

  if (req.user.role === 'COUNSELOR') {
    const userCounselor = await prisma.counselorProfile.findFirst({
      where: { userId: req.userId },
      select: { id: true }
    });
    if (!userCounselor || userCounselor.id !== counselor.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
  }

  const newLeads = await prisma.lead.count({
    where: { assignedCounselorId: req.params.id, status: 'NEW' }
  });

  res.json({ success: true, data: { newLeads } });
}));

// @route   GET /api/counselors/:id/stats
// @desc    Get counselor statistics
// @access  Private (Admin or self)
router.get('/:id/stats', authenticate, asyncHandler(async (req, res) => {
  const counselor = await prisma.counselorProfile.findUnique({
    where: { id: req.params.id }
  });

  if (!counselor) {
    return res.status(404).json({
      success: false,
      message: 'Counselor not found'
    });
  }

  // Check access
  if (req.user.role === 'COUNSELOR') {
    const userCounselor = await prisma.counselorProfile.findUnique({
      where: { userId: req.userId }
    });
    if (!userCounselor || userCounselor.id !== counselor.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
  }

  // Get lead statistics
  const [
    totalLeads,
    newLeads,
    inProgressLeads,
    enrolledLeads
  ] = await Promise.all([
    prisma.lead.count({ where: { assignedCounselorId: req.params.id } }),
    prisma.lead.count({ where: { assignedCounselorId: req.params.id, status: 'NEW' } }),
    prisma.lead.count({ where: { assignedCounselorId: req.params.id, status: { in: ['CONTACTED', 'FOLLOW_UP'] } } }),
    prisma.lead.count({ where: { assignedCounselorId: req.params.id, status: 'ENROLLED' } })
  ]);

  // Get training progress
  const trainingProgress = await prisma.trainingProgress.findMany({
    where: { counselorId: req.params.id },
    include: {
      module: {
        select: { title: true, duration: true }
      }
    }
  });

  const completedTraining = trainingProgress.filter(tp => tp.status === 'COMPLETED').length;
  const totalTraining = trainingProgress.length;
  const trainingCompletion = totalTraining > 0 ? Math.round((completedTraining / totalTraining) * 100) : 0;

  // Get presence status (model is CounselorPresence, mapped to counselor_presence)
  const presence = await prisma.counselorPresence.findUnique({
    where: { counselorId: req.params.id }
  });

  res.json({
    success: true,
    data: {
      totalLeads,
      newLeads,
      inProgressLeads,
      enrolled: enrolledLeads,
      currentLoad: counselor.currentLoad || 0,
      maxCapacity: counselor.maxCapacity || 50,
      loadPercentage: (counselor.maxCapacity || 50) > 0 
        ? Math.round(((counselor.currentLoad || 0) / (counselor.maxCapacity || 50)) * 100) 
        : 0,
      trainingCompletion,
      availability: counselor.availability,
      presenceStatus: presence?.status || 'OFFLINE',
      lastLoginAt: presence?.lastLoginAt || null,
      lastActivityAt: presence?.lastActivityAt || null,
      activeMinutesToday: presence?.activeMinutesToday || 0,
      totalActiveMinutes: presence?.totalActiveMinutes || 0
    }
  });
}));

export default router;
