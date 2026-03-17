import express from 'express';
import { body, validationResult, query } from 'express-validator';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';
import { hashPassword } from '../utils/password.js';
import { getFormFieldSettings } from './admin.js';

// Username, Email, Password always required for new accounts
const COUNSELOR_REQUIRED_ALWAYS = ['username', 'email', 'password'];

// Ensure customData column exists (idempotent - safe to run on every create)
async function ensureCustomDataColumn() {
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "counselor_profiles" ADD COLUMN IF NOT EXISTS "customData" JSONB;'
    );
  } catch (err) {
    // Ignore - column may already exist or table may not exist yet
  }
}

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
    const settings = await getFormFieldSettings();
    const cfg = settings.counselorFields || {};
    const customFields = Array.isArray(cfg.customFields) ? cfg.customFields : [];

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Counselors Template');

    const cols = [];
    // Match "Add New Counselor" fields (Settings controls visibility)
    if (cfg.username !== false) cols.push({ header: 'username', key: 'username', width: 18 });
    if (cfg.email !== false) cols.push({ header: 'email', key: 'email', width: 30 });
    if (cfg.password !== false) cols.push({ header: 'password', key: 'password', width: 18 });
    if (cfg.fullName !== false) cols.push({ header: 'full_name', key: 'full_name', width: 24 });
    if (cfg.mobile !== false) cols.push({ header: 'phone_number', key: 'phone_number', width: 18 });
    if (cfg.expertise !== false) cols.push({ header: 'expertise', key: 'expertise', width: 26 }); // comma-separated
    if (cfg.languages !== false) cols.push({ header: 'languages', key: 'languages', width: 22 }); // comma-separated
    if (cfg.availability !== false) cols.push({ header: 'availability', key: 'availability', width: 14 });
    if (cfg.maxCapacity !== false) cols.push({ header: 'max_capacity', key: 'max_capacity', width: 14 });
    if (cfg.schoolId !== false) cols.push({ header: 'assigned_school', key: 'assigned_school', width: 28 }); // school name

    // Custom fields (stored in counselorProfile.customData)
    customFields.forEach((f) => {
      if (!f?.key) return;
      cols.push({ header: String(f.key), key: String(f.key), width: 22 });
    });

    worksheet.columns = cols;

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

// @route   GET /api/counselors/export
// @desc    Export all counselors to Excel (matches Add New Counselor fields)
// @access  Private (Admin)
router.get(
  '/export',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const settings = await getFormFieldSettings();
    const cfg = settings.counselorFields || {};
    const customFields = Array.isArray(cfg.customFields) ? cfg.customFields : [];

    const counselors = await prisma.counselorProfile.findMany({
      include: {
        user: { select: { username: true, email: true } },
        school: { select: { name: true } },
      },
      orderBy: [{ fullName: 'asc' }],
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Counselors');

    const cols = [];
    if (cfg.username !== false) cols.push({ header: 'username', key: 'username', width: 18 });
    if (cfg.email !== false) cols.push({ header: 'email', key: 'email', width: 30 });
    // Password is not exported for security; leave column out even if enabled
    if (cfg.fullName !== false) cols.push({ header: 'full_name', key: 'full_name', width: 24 });
    if (cfg.mobile !== false) cols.push({ header: 'phone_number', key: 'phone_number', width: 18 });
    if (cfg.expertise !== false) cols.push({ header: 'expertise', key: 'expertise', width: 26 });
    if (cfg.languages !== false) cols.push({ header: 'languages', key: 'languages', width: 22 });
    if (cfg.availability !== false) cols.push({ header: 'availability', key: 'availability', width: 14 });
    if (cfg.maxCapacity !== false) cols.push({ header: 'max_capacity', key: 'max_capacity', width: 14 });
    if (cfg.schoolId !== false) cols.push({ header: 'assigned_school', key: 'assigned_school', width: 28 });
    customFields.forEach((f) => {
      if (!f?.key) return;
      cols.push({ header: String(f.key), key: String(f.key), width: 22 });
    });
    worksheet.columns = cols;

    counselors.forEach((c) => {
      const row = {};
      const customData = c.customData && typeof c.customData === 'object' ? c.customData : {};

      if (cfg.username !== false) row.username = c.user?.username || '';
      if (cfg.email !== false) row.email = c.user?.email || '';
      if (cfg.fullName !== false) row.full_name = c.fullName || '';
      if (cfg.mobile !== false) row.phone_number = c.mobile || '';
      if (cfg.expertise !== false) row.expertise = Array.isArray(c.expertise) ? c.expertise.join(', ') : '';
      if (cfg.languages !== false) row.languages = Array.isArray(c.languages) ? c.languages.join(', ') : '';
      if (cfg.availability !== false) row.availability = c.availability || '';
      if (cfg.maxCapacity !== false) row.max_capacity = c.maxCapacity ?? '';
      if (cfg.schoolId !== false) row.assigned_school = c.school?.name || '';

      customFields.forEach((f) => {
        if (!f?.key) return;
        const val = customData?.[f.key];
        if (Array.isArray(val)) row[f.key] = val.join(', ');
        else if (val == null) row[f.key] = '';
        else row[f.key] = String(val);
      });

      worksheet.addRow(row);
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=\"counselors_export.xlsx\"',
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
      const actualLeadCount = totalMap[c.id] ?? 0;
      const maxCap = c.maxCapacity ?? 50;
      return {
        ...c,
        stats: {
          totalLeads: actualLeadCount,
          newLeads: newMap[c.id] ?? 0,
          inProgressLeads: inProgressMap[c.id] ?? 0,
          inProgress: inProgressMap[c.id] ?? 0,
          enrolled: enrolledMap[c.id] ?? 0,
          currentLoad: actualLeadCount,
          maxCapacity: maxCap,
          loadPercentage: maxCap > 0 ? Math.round((actualLeadCount / maxCap) * 100) : 0,
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

    // Build header map (normalized)
    const normalizeHeader = (h) =>
      (h || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');

    const headerMap = {};
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      const key = normalizeHeader(cell.value);
      if (key) headerMap[key] = colNumber;
    });

    const resolveHeader = (canonical, aliases) => {
      if (headerMap[canonical]) return;
      for (const a of aliases) {
        const n = normalizeHeader(a);
        if (headerMap[n]) {
          headerMap[canonical] = headerMap[n];
          return;
        }
      }
    };

    resolveHeader('username', ['username', 'user_name']);
    resolveHeader('email', ['email', 'gmail', 'mail']);
    resolveHeader('password', ['password', 'pass', 'pwd']);
    resolveHeader('full_name', ['full_name', 'fullname', 'full name', 'fullName', 'name']);
    resolveHeader('phone_number', ['phone_number', 'phone', 'mobile', 'mobile_number', 'mobile number']);
    resolveHeader('expertise', ['expertise', 'specializations', 'specialization']);
    resolveHeader('languages', ['languages', 'language']);
    resolveHeader('availability', ['availability', 'availability_status', 'status']);
    resolveHeader('max_capacity', ['max_capacity', 'maxcapacity', 'capacity', 'max capacity']);
    resolveHeader('assigned_school', ['assigned_school', 'assigned school', 'school', 'school_name', 'assigned_school_name']);
    resolveHeader('school_id', ['school_id', 'schoolid']);

    // Settings-driven requirements (match Add New Counselor)
    const settings = await getFormFieldSettings();
    const cfg = settings.counselorFields || {};
    const requiredWhenShownAlways = ['fullName', 'mobile', 'expertise', 'languages'];
    const isRequired = (key) => {
      if (cfg[key] === false) return false;
      if (COUNSELOR_REQUIRED_ALWAYS.includes(key)) return true;
      if (requiredWhenShownAlways.includes(key)) return true;
      return cfg.requiredFields?.[key] === true;
    };

    // Validate that core columns exist (at least email; username/password if enabled)
    const requiredColumns = [];
    if (cfg.email !== false) requiredColumns.push('email');
    if (cfg.username !== false) requiredColumns.push('username');
    if (cfg.password !== false) requiredColumns.push('password');
    if (cfg.fullName !== false && isRequired('fullName')) requiredColumns.push('full_name');
    if (cfg.mobile !== false && isRequired('mobile')) requiredColumns.push('phone_number');
    if (cfg.expertise !== false && isRequired('expertise')) requiredColumns.push('expertise');
    if (cfg.languages !== false && isRequired('languages')) requiredColumns.push('languages');
    if (cfg.availability !== false && isRequired('availability')) requiredColumns.push('availability');
    if (cfg.maxCapacity !== false && isRequired('maxCapacity')) requiredColumns.push('max_capacity');
    if (cfg.schoolId !== false && isRequired('schoolId')) requiredColumns.push('assigned_school');

    const missingHeaders = requiredColumns.filter((h) => !headerMap[h]);
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

    const splitList = (value) => {
      const s = (value || '').toString().trim();
      if (!s) return [];
      return s
        .split(/[,\|;]+/)
        .map((x) => x.trim())
        .filter(Boolean);
    };

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const firstCell =
        (headerMap.email ? row.getCell(headerMap.email).value : null) ||
        (headerMap.username ? row.getCell(headerMap.username).value : null);
      if (!firstCell) return;

      results.totalRows += 1;

      const getCellValue = (header) =>
        headerMap[header]
          ? (row.getCell(headerMap[header])?.value?.toString().trim() || '')
          : '';

      const username = getCellValue('username');
      const email = getCellValue('email').toLowerCase();
      const password = getCellValue('password');
      const fullName = getCellValue('full_name');
      const phone = getCellValue('phone_number');
      const expertise = splitList(getCellValue('expertise'));
      const languages = splitList(getCellValue('languages'));
      const availability = getCellValue('availability') || 'ACTIVE';
      const maxCapacityRaw = getCellValue('max_capacity');
      const maxCapacity = maxCapacityRaw ? parseInt(maxCapacityRaw, 10) : 50;
      const assignedSchool = getCellValue('assigned_school');
      const schoolIdFromFile = getCellValue('school_id');

      // Custom fields -> customData
      const customData = {};
      const customDefs = Array.isArray(cfg.customFields) ? cfg.customFields : [];
      customDefs.forEach((f) => {
        if (!f?.key) return;
        const k = normalizeHeader(f.key);
        // If the header key exists in excel, read it
        if (!headerMap[k]) return;
        const raw = row.getCell(headerMap[k])?.value;
        const val = raw?.toString?.().trim?.() ?? '';
        if (val === '') return;

        if (f.type === 'checkbox') {
          customData[f.key] = splitList(val);
        } else if (f.type === 'number') {
          const num = Number(val);
          customData[f.key] = Number.isFinite(num) ? num : val;
        } else {
          customData[f.key] = val;
        }
      });

      const rowErrors = [];
      if (cfg.username !== false && !username) rowErrors.push('username is required');
      if (cfg.email !== false && !email) rowErrors.push('email is required');
      if (cfg.password !== false && (!password || password.length < 6)) rowErrors.push('password is required (min 6 chars)');
      if (cfg.fullName !== false && isRequired('fullName') && !fullName) rowErrors.push('full_name is required');
      if (cfg.mobile !== false && isRequired('mobile') && !phone) rowErrors.push('phone_number is required');
      if (cfg.expertise !== false && isRequired('expertise') && expertise.length === 0) rowErrors.push('expertise is required (comma-separated list)');
      if (cfg.languages !== false && isRequired('languages') && languages.length === 0) rowErrors.push('languages is required (comma-separated list)');
      if (cfg.availability !== false && isRequired('availability') && !availability) rowErrors.push('availability is required');
      if (cfg.maxCapacity !== false && isRequired('maxCapacity') && (!maxCapacity || maxCapacity < 1)) rowErrors.push('max_capacity is required (>=1)');
      if (cfg.schoolId !== false && isRequired('schoolId') && !assignedSchool && !schoolIdFromFile) rowErrors.push('assigned_school is required');

      // Required custom fields validation (if column exists)
      customDefs.forEach((f) => {
        if (!f?.key || f.required !== true) return;
        const k = normalizeHeader(f.key);
        if (!headerMap[k]) return; // only enforce when column is present in template/file
        const raw = row.getCell(headerMap[k])?.value;
        const val = raw?.toString?.().trim?.() ?? '';
        if (!val) rowErrors.push(`${f.key} is required`);
      });

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
        data: {
          username,
          email,
          password,
          fullName,
          phone,
          expertise,
          languages,
          availability,
          maxCapacity,
          assignedSchool,
          schoolIdFromFile,
          customData,
        },
      });
    });

    // Ensure customData column exists (safe to run every time)
    await ensureCustomDataColumn();

    await prisma.$transaction(async (tx) => {
      for (const row of rowsToInsert) {
        const {
          rowNumber,
          data: {
            username,
            email,
            password,
            fullName,
            phone,
            expertise,
            languages,
            availability,
            maxCapacity,
            assignedSchool,
            schoolIdFromFile,
            customData,
          },
        } = row;

        const perRowErrors = [];

        // Skip duplicates by username/email
        const existingUser = await tx.user.findFirst({
          where: { OR: [{ email }, { username }] },
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
        if (schoolIdFromFile) {
          schoolId = schoolIdFromFile;
        } else if (assignedSchool) {
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

        const finalPassword = password && password.length >= 6 ? password : 'Counselor@123';
        const hashedPassword = await hashPassword(finalPassword);

        // Respect Settings visibility defaults (same as create counselor route)
        const finalFullName = (cfg.fullName !== false && fullName) ? String(fullName).trim() : 'N/A';
        const finalMobile = (cfg.mobile !== false && phone) ? String(phone).trim() : '';
        const finalExpertise = (cfg.expertise !== false && Array.isArray(expertise)) ? expertise : [];
        const finalLanguages = (cfg.languages !== false && Array.isArray(languages)) ? languages : [];
        const finalSchoolId = (cfg.schoolId !== false && schoolId) ? schoolId : null;

        const user = await tx.user.create({
          data: {
            username,
            email,
            password: hashedPassword,
            role: 'COUNSELOR',
          },
        });

        const counselorProfile = await tx.counselorProfile.create({
          data: {
            userId: user.id,
            fullName: finalFullName,
            mobile: finalMobile,
            expertise: finalExpertise,
            languages: finalLanguages,
            availability: (cfg.availability !== false && availability) ? availability : 'ACTIVE',
            maxCapacity: Math.max(1, parseInt(maxCapacity, 10) || 50),
            currentLoad: 0,
            schoolId: finalSchoolId,
          },
        });

        // Set customData via raw SQL
        const hasCustomData = customData && typeof customData === 'object' && Object.keys(customData).length > 0;
        if (hasCustomData) {
          const valueStr = JSON.stringify(JSON.parse(JSON.stringify(customData)));
          await tx.$executeRaw(Prisma.sql`
            UPDATE "counselor_profiles" SET "customData" = ${valueStr}::jsonb WHERE "id" = ${counselorProfile.id}
          `);
        }

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

// @route   GET /api/counselors/me
// @desc    Get current counselor's profile id (for dropdowns / scheduling)
// @access  Private (Counselor only)
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  if (req.user.role !== 'COUNSELOR') {
    return res.status(403).json({ success: false, message: 'Not a counselor' });
  }
  const profile = await prisma.counselorProfile.findFirst({
    where: { userId: req.userId },
    select: { id: true, fullName: true }
  });
  if (!profile) {
    return res.status(404).json({ success: false, message: 'Counselor profile not found' });
  }
  res.json({ success: true, data: { id: profile.id, fullName: profile.fullName } });
}));

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

  // Always fetch customData via raw SQL (Prisma client may omit Json fields)
  let customData = counselor.customData;
  try {
    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT "customData" FROM "counselor_profiles" WHERE "id" = ${req.params.id} LIMIT 1
    `);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row?.customData != null) customData = row.customData;
  } catch (err) {
    // Ignore - column may not exist
  }

  res.json({
    success: true,
    data: { counselor: { ...counselor, customData } }
  });
}));

// @route   POST /api/counselors
// @desc    Create counselor (Admin only). Validates per Settings (counselorFields).
// @access  Private (Admin)
router.post('/', authenticate, authorize('ADMIN'), [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('fullName').optional().trim(),
  body('mobile').optional().trim(),
  body('expertise').optional().isArray(),
  body('languages').optional().isArray()
], asyncHandler(async (req, res) => {
  const expressErrors = validationResult(req);
  if (!expressErrors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: expressErrors.array()
    });
  }

  const { username, email, password, fullName, mobile, expertise, languages, availability, maxCapacity, schoolId, customData } = req.body;

  // Fetch form settings and validate only required fields
  const settings = await getFormFieldSettings();
  const cfg = settings.counselorFields || {};
  const requiredWhenShownAlways = ['fullName', 'mobile', 'expertise', 'languages'];
  const isRequired = (key) => {
    if (cfg[key] === false) return false; // field hidden in settings
    if (COUNSELOR_REQUIRED_ALWAYS.includes(key)) return true;
    if (requiredWhenShownAlways.includes(key)) return true; // always required when shown
    return cfg.requiredFields?.[key] === true;
  };

  const validationErrors = [];
  if (isRequired('fullName') && (!fullName || !String(fullName).trim())) validationErrors.push({ msg: 'Full name is required', path: 'fullName' });
  if (isRequired('mobile') && (!mobile || !String(mobile).trim())) validationErrors.push({ msg: 'Mobile number is required', path: 'mobile' });
  if (isRequired('expertise')) {
    const exp = Array.isArray(expertise) ? expertise : [];
    if (exp.length === 0) validationErrors.push({ msg: 'At least one expertise is required', path: 'expertise' });
  }
  if (isRequired('languages')) {
    const langs = Array.isArray(languages) ? languages : [];
    if (langs.length === 0) validationErrors.push({ msg: 'At least one language is required', path: 'languages' });
  }
  if (isRequired('schoolId') && !schoolId) validationErrors.push({ msg: 'Assigned school is required', path: 'schoolId' });
  if (isRequired('availability') && !availability) validationErrors.push({ msg: 'Availability is required', path: 'availability' });
  if (isRequired('maxCapacity') && (maxCapacity == null || maxCapacity === '' || (parseInt(maxCapacity, 10) || 0) < 1)) validationErrors.push({ msg: 'Max capacity is required', path: 'maxCapacity' });

  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: validationErrors
    });
  }

  // Use defaults for hidden/optional fields
  const finalFullName = (cfg.fullName !== false && fullName) ? String(fullName).trim() : 'N/A';
  const finalMobile = (cfg.mobile !== false && mobile) ? String(mobile).trim() : '';
  const finalExpertise = (cfg.expertise !== false && Array.isArray(expertise)) ? expertise : [];
  const finalLanguages = (cfg.languages !== false && Array.isArray(languages)) ? languages : [];
  const finalSchoolId = (cfg.schoolId !== false && schoolId) ? schoolId : null;

  // Ensure customData column exists before create
  await ensureCustomDataColumn();

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
        fullName: finalFullName,
        mobile: finalMobile,
        expertise: finalExpertise,
        languages: finalLanguages,
        availability: (cfg.availability !== false && availability) ? availability : 'ACTIVE',
        maxCapacity: Math.max(1, parseInt(maxCapacity, 10) || 50),
        schoolId: finalSchoolId
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

    // Set customData via raw SQL (avoids Prisma Json field issues with older clients)
    const hasCustomData = customData && typeof customData === 'object' && Object.keys(customData).length > 0;
    if (hasCustomData) {
      const valueStr = JSON.stringify(JSON.parse(JSON.stringify(customData)));
      await tx.$executeRaw(Prisma.sql`
        UPDATE "counselor_profiles" SET "customData" = ${valueStr}::jsonb WHERE "id" = ${counselorProfile.id}
      `);
    }

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
  await ensureCustomDataColumn();

  const counselor = await prisma.counselorProfile.findUnique({
    where: { id: req.params.id }
  });

  if (!counselor) {
    return res.status(404).json({
      success: false,
      message: 'Counselor not found'
    });
  }

  const allowedFields = ['fullName', 'mobile', 'expertise', 'languages', 'availability', 'maxCapacity', 'schoolId', 'customData'];
  const updateData = {};
  let customDataToSet = null;
  Object.keys(req.body).forEach(key => {
    if (allowedFields.includes(key)) {
      const val = req.body[key];
      if (key === 'customData' && val && typeof val === 'object') {
        customDataToSet = JSON.parse(JSON.stringify(val));
      } else if (key === 'maxCapacity') {
        updateData[key] = Math.max(1, parseInt(val, 10) || 50);
      } else if (key !== 'customData') {
        updateData[key] = val;
      }
    }
  });

  let updatedCounselor = await prisma.counselorProfile.update({
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

  // Set customData via raw SQL (avoids Prisma Json field issues)
  if (customDataToSet !== null) {
    const valueStr = JSON.stringify(customDataToSet);
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "counselor_profiles" SET "customData" = ${valueStr}::jsonb WHERE "id" = ${req.params.id}
    `);
    updatedCounselor = await prisma.counselorProfile.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { username: true, email: true } },
        school: { select: { id: true, name: true } }
      }
    });
  }

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

// @route   DELETE /api/counselors/:id
// @desc    Delete counselor (Admin only)
// @access  Private (Admin)
router.delete('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const counselor = await prisma.counselorProfile.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { id: true, username: true } } }
  });

  if (!counselor) {
    return res.status(404).json({
      success: false,
      message: 'Counselor not found'
    });
  }

  const userId = counselor.userId;

  await prisma.$transaction(async (tx) => {
    await tx.counselorProfile.delete({ where: { id: req.params.id } });
    await tx.user.delete({ where: { id: userId } });
  });

  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'DELETE_COUNSELOR',
      entityType: 'COUNSELOR',
      entityId: req.params.id,
      details: { deletedCounselor: counselor.fullName }
    }
  });

  res.json({
    success: true,
    message: 'Counselor deleted successfully'
  });
}));

// @route   GET /api/counselors/:id/leads
// @desc    Get leads assigned to counselor (only that counselor's assigned leads)
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

  // For counselors: must request own leads only; use resolved profile id for query
  let counselorIdForLeads = counselor.id;
  if (req.user.role === 'COUNSELOR') {
    const userCounselor = await prisma.counselorProfile.findFirst({
      where: { userId: req.userId }
    });
    if (!userCounselor || userCounselor.id !== counselor.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    counselorIdForLeads = userCounselor.id;
  }

  let leads;
  try {
    leads = await prisma.lead.findMany({
      where: { assignedCounselorId: counselorIdForLeads },
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
        notes: true,
        submittedAt: true,
        institution: { select: { name: true, type: true } },
        course: { select: { name: true, code: true } }
      },
      orderBy: { submittedAt: 'desc' }
    });
  } catch (err) {
    console.error('[GET /counselors/:id/leads]', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load leads. Please try again or contact support.'
    });
  }

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

// @route   GET /api/counselors/:id/daily-priority
// @desc    Counselor daily work plan: overdue, weekend missed, hot leads, today scheduled, new leads (Smart Triage)
// @access  Private (Admin or self)
//
// Data sources (no default values — counts come from DB):
// - Weekend Missed: (1) Overdue sessions with followUpDate on Fri/Sat/Sun (CounselingSession.followUpDate),
//   (2) NEW leads with submittedAt Fri–Sun (Lead.submittedAt),
//   (3) Leads scheduled Mon–Sun of last week but never counselled/contacted (session still SCHEDULED/RESCHEDULED)
// - Hot Leads: Leads where classification=PRIORITY OR priority IN [HIGH,URGENT], excl. ENROLLED/REJECTED
//   (Lead.classification, Lead.priority — set via Edit Lead or import columns)
router.get('/:id/daily-priority', authenticate, asyncHandler(async (req, res) => {
  const counselorId = req.params.id;
  const counselor = await prisma.counselorProfile.findUnique({
    where: { id: counselorId },
    select: { id: true, fullName: true, userId: true }
  });
  if (!counselor) return res.status(404).json({ success: false, message: 'Counselor not found' });
  if (req.user.role === 'COUNSELOR') {
    const userCp = await prisma.counselorProfile.findFirst({ where: { userId: req.userId }, select: { id: true } });
    if (!userCp || userCp.id !== counselorId) return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const dow = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const weekAgo = new Date(todayStart);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Weekend window: most recent Fri 00:00 to Sun 23:59 (show on Mon/Tue)
  const getWeekendBounds = () => {
    const f = new Date(todayStart);
    f.setDate(f.getDate() - ((dow === 0 ? 7 : dow) + 2)); // go back to last Friday
    const fStart = new Date(f.getFullYear(), f.getMonth(), f.getDate(), 0, 0, 0, 0);
    const sEnd = new Date(fStart);
    sEnd.setDate(sEnd.getDate() + 2);
    sEnd.setHours(23, 59, 59, 999);
    return { fStart, sEnd };
  };
  const { fStart: weekendStart, sEnd: weekendEnd } = getWeekendBounds();

  // Last week Mon 00:00 - Sun 23:59 (leads scheduled during the week but not contacted/counselled by Sunday)
  const getLastWeekBounds = () => {
    const m = new Date(todayStart);
    m.setDate(m.getDate() - (dow === 0 ? 7 : dow + 6)); // go back to last Monday
    const monStart = new Date(m.getFullYear(), m.getMonth(), m.getDate(), 0, 0, 0, 0);
    const sunEnd = new Date(monStart);
    sunEnd.setDate(sunEnd.getDate() + 6);
    sunEnd.setHours(23, 59, 59, 999);
    return { monStart, sunEnd };
  };
  const { monStart: lastWeekMonStart, sunEnd: lastWeekSunEnd } = getLastWeekBounds();

  // Run all independent queries in parallel for speed
  const [
    overdueSessions,
    missedSessions,
    sessionOverdueRows,
    sessionOverdueNoUpdateRows,
    overdueTodosCount,
    weekendNewLeads,
    hotLeads,
    todaySessions,
    newLeadsRaw,
    lastWeekScheduledMissed
  ] = await Promise.all([
    prisma.counselingSession.findMany({
    where: {
      counselorId,
      followUpRequired: true,
      followUpDate: { not: null, lt: todayStart }
    },
    select: { leadId: true, followUpDate: true, lead: { select: { id: true, studentName: true, parentName: true, priority: true } } }
  }),
  prisma.counselingSession.findMany({
    where: {
      counselorId,
      status: { in: ['SCHEDULED', 'RESCHEDULED'] },
      scheduledDate: { lt: now }
    },
    select: { leadId: true, lead: { select: { id: true, studentName: true, parentName: true, priority: true } } }
  }),
  // Missed sessions: isOverdue OR attempts exhausted — unique leads (1 per lead, not per session)
  prisma.$queryRaw`
    SELECT DISTINCT cs."leadId", l.id, l."studentName", l."parentName", l.priority
    FROM "counseling_sessions" cs
    JOIN "leads" l ON l.id = cs."leadId"
    WHERE cs."counselorId" = ${counselorId}
      AND cs.status != 'COMPLETED'
      AND (cs."isOverdue" = true OR cs."attemptCount" >= cs."maxAttempts")
  `,
  // Session ended 1+ hr ago and lead not updated within 1 hr after session time
  prisma.$queryRaw`
    SELECT DISTINCT cs."leadId", l.id, l."studentName", l."parentName", l.priority
    FROM "counseling_sessions" cs
    JOIN "leads" l ON l.id = cs."leadId"
    WHERE cs."counselorId" = ${counselorId}
      AND cs.status != 'COMPLETED'
      AND (cs."scheduledDate" + interval '1 hour') < now()
      AND l."updatedAt" < (cs."scheduledDate" + interval '1 hour')
  `,
  prisma.todo.count({
    where: {
      userId: counselor.userId,
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      dueDate: { not: null, lt: todayStart }
    }
  }),
  prisma.lead.findMany({
    where: {
      assignedCounselorId: counselorId,
      status: 'NEW',
      submittedAt: { gte: weekendStart, lte: weekendEnd }
    },
    select: { id: true, studentName: true, parentName: true, submittedAt: true }
  }),
  prisma.lead.findMany({
    where: {
      assignedCounselorId: counselorId,
      status: { notIn: ['ENROLLED', 'REJECTED'] },
      OR: [
        { classification: 'PRIORITY' },
        { priority: { in: ['HIGH', 'URGENT'] } }
      ]
    },
    select: { id: true, studentName: true, parentName: true, priority: true, classification: true }
  }),
  prisma.counselingSession.findMany({
    where: {
      counselorId,
      scheduledDate: { gte: todayStart, lte: todayEnd },
      status: { in: ['SCHEDULED', 'RESCHEDULED'] }
    },
    select: { leadId: true }
  }),
  prisma.lead.findMany({
    where: { assignedCounselorId: counselorId, status: 'NEW' },
    select: { id: true }
  }),
  // Leads scheduled Mon-Sun of last week but never counselled/contacted (session still SCHEDULED/RESCHEDULED)
  prisma.counselingSession.findMany({
    where: {
      counselorId,
      status: { in: ['SCHEDULED', 'RESCHEDULED'] },
      scheduledDate: { gte: lastWeekMonStart, lte: lastWeekSunEnd },
      lead: {
        assignedCounselorId: counselorId,
        status: { notIn: ['ENROLLED', 'REJECTED'] }
      }
    },
    select: { leadId: true }
  })
  ]);

  const overdueByLead = new Map();
  overdueSessions.forEach((s) => {
    if (!s.followUpDate) return;
    const daysPending = Math.max(0, Math.ceil((todayStart - new Date(s.followUpDate)) / 86400000));
    const existing = overdueByLead.get(s.leadId);
    if (!existing || daysPending > existing.daysPending) {
      overdueByLead.set(s.leadId, {
        leadId: s.lead.id,
        leadName: s.lead.studentName || s.lead.parentName || 'Lead',
        daysPending,
        priority: s.lead.priority || 'NORMAL'
      });
    }
  });
  missedSessions.forEach((s) => {
    if (!s.leadId || !s.lead) return;
    const existing = overdueByLead.get(s.leadId);
    if (!existing) {
      overdueByLead.set(s.leadId, {
        leadId: s.lead.id,
        leadName: s.lead.studentName || s.lead.parentName || 'Lead',
        daysPending: 1,
        priority: s.lead.priority || 'NORMAL'
      });
    }
  });
  // Missed sessions (3/3 attempts or isOverdue) — dedupe by lead (1 count per lead)
  (Array.isArray(sessionOverdueRows) ? sessionOverdueRows : []).forEach((row) => {
    const lid = row.leadId ?? row.id;
    if (!lid) return;
    const existing = overdueByLead.get(lid);
    if (!existing) {
      overdueByLead.set(lid, {
        leadId: lid,
        leadName: row.studentName || row.parentName || 'Lead',
        daysPending: 1,
        priority: row.priority || 'NORMAL'
      });
    }
  });
  // Session ended 1+ hr ago and lead not updated within 1 hr — dedupe by lead
  (Array.isArray(sessionOverdueNoUpdateRows) ? sessionOverdueNoUpdateRows : []).forEach((row) => {
    const lid = row.leadId ?? row.id;
    if (!lid) return;
    const existing = overdueByLead.get(lid);
    if (!existing) {
      overdueByLead.set(lid, {
        leadId: lid,
        leadName: row.studentName || row.parentName || 'Lead',
        daysPending: 1,
        priority: row.priority || 'NORMAL'
      });
    }
  });

  const overdueList = Array.from(overdueByLead.values());
  const overdueLeadIds = overdueList.map((o) => o.leadId);
  const overdueCount = overdueList.length;

  let saturdayCount = 0;
  let sundayCount = 0;
  const weekendLeadIds = new Set();
  overdueSessions.forEach((s) => {
    if (!s.followUpDate) return;
    const d = new Date(s.followUpDate);
    const sd = d.getDay();
    if (sd === 5) weekendLeadIds.add(s.leadId); // Friday
    else if (sd === 6) { saturdayCount++; weekendLeadIds.add(s.leadId); }
    else if (sd === 0) { sundayCount++; weekendLeadIds.add(s.leadId); }
  });
  weekendNewLeads.forEach((l) => weekendLeadIds.add(l.id));
  // Leads scheduled Mon-Sun of last week but never counselled/contacted by end of Sunday
  lastWeekScheduledMissed.forEach((s) => weekendLeadIds.add(s.leadId));
  const weekendMissedCount = weekendLeadIds.size;

  const hotLeadIds = hotLeads.map((h) => h.id);
  const hotLeadsCount = hotLeads.length;

  const todayScheduledLeadIds = [...new Set(todaySessions.map((s) => s.leadId))];
  const todaySessionsCount = todayScheduledLeadIds.length;

  const newLeadIds = newLeadsRaw.map((l) => l.id);
  const newLeadsTotalCount = newLeadsRaw.length;

  // Weekly snapshot + lead lists for drill-down
  const [totalAssigned, enrolledCount, pendingFromLastWeek, enrolledLeadsList, pendingLeadsList, assignedLeadsSample] = await Promise.all([
    prisma.lead.count({ where: { assignedCounselorId: counselorId } }),
    prisma.lead.count({ where: { assignedCounselorId: counselorId, status: 'ENROLLED' } }),
    prisma.lead.count({
      where: {
        assignedCounselorId: counselorId,
        status: { in: ['CONTACTED', 'FOLLOW_UP'] },
        updatedAt: { lt: todayStart }
      }
    }),
    prisma.lead.findMany({
      where: { assignedCounselorId: counselorId, status: 'ENROLLED' },
      select: { id: true, leadId: true, studentName: true, parentName: true, parentMobile: true, status: true, submittedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 100
    }),
    prisma.lead.findMany({
      where: {
        assignedCounselorId: counselorId,
        status: { in: ['CONTACTED', 'FOLLOW_UP'] },
        updatedAt: { lt: todayStart }
      },
      select: { id: true, leadId: true, studentName: true, parentName: true, parentMobile: true, status: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 100
    }),
    prisma.lead.findMany({
      where: { assignedCounselorId: counselorId },
      select: { id: true, leadId: true, studentName: true, parentName: true, parentMobile: true, status: true, submittedAt: true },
      orderBy: { submittedAt: 'desc' },
      take: 100
    })
  ]);
  const conversionPct = totalAssigned > 0 ? Math.round((enrolledCount / totalAssigned) * 100) : 0;

  // Priority view (virtual)
  const priorityView = [];
  let rank = 1;
  overdueList.forEach((o) => {
    priorityView.push({ counselorId, leadId: o.leadId, priorityRank: rank++, reason: 'Overdue follow-up', daysPending: o.daysPending });
  });
  hotLeads.slice(0, 50).forEach((h) => {
    priorityView.push({ counselorId, leadId: h.id, priorityRank: rank++, reason: 'Hot lead', daysPending: 0 });
  });
  const presence = await prisma.counselorPresence.findUnique({
    where: { counselorId },
    select: { lastLoginAt: true }
  });

  // Waterfall order: Mon/Tue -> Weekend Missed #1, Overdue #2; else Overdue #1
  const isMondayOrTuesday = dow === 1 || dow === 2;
  const actionOrder = isMondayOrTuesday && weekendMissedCount > 0
    ? ['weekend_missed', 'overdue', 'hot', 'today_scheduled', 'new']
    : ['overdue', 'weekend_missed', 'hot', 'today_scheduled', 'new'];

  // Session lifecycle counts: retry required (missed-session leads are in overdueByLead)
  const sessionRetryResult = await prisma.$queryRaw`SELECT COUNT(*)::int as c FROM "counseling_sessions" WHERE "counselorId" = ${counselorId} AND status = 'NOT_CONNECTED' AND "attemptCount" < "maxAttempts"`;
  const sessionRetryCount = Array.isArray(sessionRetryResult) && sessionRetryResult[0] ? Number(sessionRetryResult[0].c) : 0;

  res.json({
    success: true,
    data: {
      greeting: {
        displayName: counselor.fullName,
        loginTime: presence?.lastLoginAt || now
      },
      counts: {
        overdueFollowUps: overdueCount,
        overdueTodos: overdueTodosCount,
        overdue: overdueCount + overdueTodosCount,
        weekendMissed: weekendMissedCount,
        hotLeadsPending: hotLeadsCount,
        todayScheduled: todaySessionsCount,
        newLeads: newLeadsTotalCount,
        sessionRetry: sessionRetryCount
      },
      leadIds: {
        overdue: overdueLeadIds,
        weekendMissed: Array.from(weekendLeadIds),
        hot: hotLeadIds,
        todayScheduled: todayScheduledLeadIds,
        new: newLeadIds
      },
      actionOrder,
      isMondayOrTuesday,
      missedWorkSummary: {
        saturdayCount,
        sundayCount,
        items: overdueList
      },
      priorityView,
      weeklySnapshot: {
        totalAssigned,
        pendingFromLastWeek,
        converted: enrolledCount,
        missedFollowUps: overdueCount,
        conversionPct,
        totalAssignedLeads: assignedLeadsSample,
        pendingFromLastWeekLeads: pendingLeadsList,
        convertedLeads: enrolledLeadsList,
        missedFollowUpLeads: overdueList.map((o) => ({ id: o.leadId, leadId: null, studentName: o.leadName, parentName: null, parentMobile: null, status: null, daysPending: o.daysPending, priority: o.priority || 'NORMAL' }))
      },
      highConversionLeads: hotLeads.slice(0, 10)
    }
  });
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
