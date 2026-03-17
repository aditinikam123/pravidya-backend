/**
 * Historical Admissions & Marketing Intelligence
 * - Excel/CSV import with validation, preview, duplicate detection
 * - Photo-to-Excel OCR conversion
 * - 5-year trend analysis
 * - Marketing recommendations
 * - PDF/Excel export
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, '..', 'uploads', 'historical-marketing');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '';
    const base = (file.originalname || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.[^.]+$/, '') || 'file';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 9) + '-' + base + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (['.xlsx', '.xls', '.csv', '.jpg', '.jpeg', '.png'].includes(ext)) return cb(null, true);
    cb(new Error('Allowed: .xlsx, .xls, .csv, .jpg, .jpeg, .png'));
  },
});

const router = express.Router();

// Required columns for import
const REQUIRED_COLUMNS = [
  'academic_year',
  'course_name',
  'total_inquiries',
  'total_applications',
  'confirmed_admissions',
  'male_count',
  'female_count',
  'zip_code',
  'marketing_channel',
  'marketing_spend',
  'leads_generated',
  'admissions_from_campaign',
];

const COLUMN_ALIASES = {
  academic_year: ['academic year', 'academicyear', 'year', 'academic year'],
  course_name: ['course name', 'coursename', 'course'],
  total_inquiries: ['total inquiries', 'inquiries', 'totalinquiries'],
  total_applications: ['total applications', 'applications', 'totalapplications'],
  confirmed_admissions: ['confirmed admissions', 'admissions', 'confirmedadmissions'],
  male_count: ['male count', 'male', 'malecount', 'males'],
  female_count: ['female count', 'female', 'femalecount', 'females'],
  zip_code: ['zip code', 'zipcode', 'zip', 'pincode'],
  marketing_channel: ['marketing channel', 'channel', 'marketingchannel'],
  marketing_spend: ['marketing spend', 'spend', 'marketingspend'],
  leads_generated: ['leads generated', 'leads', 'leadsgenerated'],
  admissions_from_campaign: ['admissions from campaign', 'campaign admissions', 'admissionsfromcampaign'],
};

function normalizeCol(s) {
  return (s || '').toString().trim().toLowerCase().replace(/\s+/g, '_');
}

function buildHeaderMap(rawHeaders) {
  const map = {};
  const normMap = {};
  Object.entries(COLUMN_ALIASES).forEach(([canon, aliases]) => {
    [canon, ...aliases].forEach((a) => { normMap[normalizeCol(a)] = canon; });
  });
  rawHeaders.forEach((h, i) => {
    const norm = normalizeCol(h);
    const canon = normMap[norm] || norm;
    if (canon && !map[canon]) map[canon] = i + 1; // 1-based Excel column index
  });
  return map;
}

function parseNum(val) {
  if (val == null || val === '') return 0;
  const s = String(val).replace(/\s/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

function parseYear(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}$/.test(s) || /^\d{4}-\d{4}$/.test(s)) return s;
  const m = s.match(/\d{4}/);
  return m ? m[0] + '-' + (parseInt(m[0], 10) + 1).toString().slice(-2) : s;
}

/**
 * Parse Excel/CSV and return { headers, rows, errors } for preview
 */
async function parseFileForPreview(filePath, ext) {
  const rows = [];
  let rawHeaders = [];

  if (ext === 'csv') {
    const workbook = new ExcelJS.Workbook();
    await workbook.csv.readFile(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { headers: [], rows: [], errors: [] };
    let rowNum = 0;
    sheet.eachRow((row, rn) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, cn) => { vals[cn] = (cell.value ?? '').toString().trim(); });
      if (rn === 1) rawHeaders = vals.filter(Boolean);
      else if (vals.some(Boolean)) rows.push({ _row: rn, values: vals });
      rowNum = rn;
    });
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { headers: [], rows: [], errors: [] };
    let rowNum = 0;
    sheet.eachRow((row, rn) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, cn) => { vals[cn] = (cell.value ?? '').toString().trim(); });
      if (rn === 1) rawHeaders = vals.filter(Boolean);
      else if (vals.some(Boolean)) rows.push({ _row: rn, values: vals });
      rowNum = rn;
    });
  }

  const headerMap = buildHeaderMap(rawHeaders);
  const missing = REQUIRED_COLUMNS.filter((c) => !headerMap[c]);
  const errors = missing.length ? [{ row: 0, message: `Missing required columns: ${missing.join(', ')}` }] : [];

  const parsed = rows.slice(0, 500).map((r) => {
    const obj = {};
    REQUIRED_COLUMNS.forEach((col) => {
      const idx = headerMap[col];
      const val = idx != null && r.values[idx] != null ? r.values[idx] : '';
      if (col === 'academic_year') obj.academicYear = parseYear(val) || val;
      else if (col === 'course_name') obj.courseName = String(val || '').trim() || null;
      else if (col === 'zip_code') obj.zipCode = String(val || '').trim() || null;
      else if (col === 'marketing_channel') obj.marketingChannel = String(val || '').trim() || null;
      else if (col === 'marketing_spend') obj.marketingSpend = parseNum(val) || null;
      else if (col === 'total_inquiries') obj.totalInquiries = parseNum(val);
      else if (col === 'total_applications') obj.totalApplications = parseNum(val);
      else if (col === 'confirmed_admissions') obj.confirmedAdmissions = parseNum(val);
      else if (col === 'male_count') obj.maleCount = parseNum(val);
      else if (col === 'female_count') obj.femaleCount = parseNum(val);
      else if (col === 'leads_generated') obj.leadsGenerated = parseNum(val) || null;
      else if (col === 'admissions_from_campaign') obj.admissionsFromCampaign = parseNum(val) || null;
    });
    obj._row = r._row;
    obj._errors = [];
    if (!obj.academicYear) obj._errors.push('Academic Year required');
    if (!obj.courseName) obj._errors.push('Course Name required');
    if (obj.totalInquiries < 0 || obj.totalApplications < 0 || obj.confirmedAdmissions < 0)
      obj._errors.push('Counts must be non-negative');
    return obj;
  });

  return { headers: rawHeaders, rows: parsed, headerMap, errors };
}

// GET /api/historical-marketing/template – download sample Excel template
router.get(
  '/template',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Historical Data');
    const headers = [
      'Academic Year',
      'Course Name',
      'Total Inquiries',
      'Total Applications',
      'Confirmed Admissions',
      'Male Count',
      'Female Count',
      'Zip Code',
      'Marketing Channel',
      'Marketing Spend',
      'Leads Generated',
      'Admissions from Campaign',
    ];
    sheet.addRow(headers);
    sheet.addRow(['2023-24', 'Computer Science', 150, 120, 80, 45, 35, '400071', 'Digital', 50000, 80, 25]);
    sheet.addRow(['2023-24', 'Commerce', 200, 160, 100, 55, 45, '400072', 'Print', 30000, 60, 18]);
    sheet.columns.forEach((col, i) => { col.width = 18; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=historical_marketing_template.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  })
);

// POST /api/historical-marketing/import/preview – upload Excel/CSV, return parsed rows with validation
router.post(
  '/import/preview',
  authenticate,
  authorize('ADMIN'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const institutionId = req.body.institutionId;
    if (!institutionId) return res.status(400).json({ success: false, message: 'Institution is required' });

    const inst = await prisma.institution.findUnique({ where: { id: institutionId } });
    if (!inst) return res.status(400).json({ success: false, message: 'Institution not found' });

    const ext = (path.extname(req.file.originalname || '') || '').toLowerCase().replace('.', '') || 'xlsx';
    const result = await parseFileForPreview(req.file.path, ext === 'csv' ? 'csv' : 'xlsx');

    // Duplicate year detection: check existing records for same institution + academicYear
    const yearsInFile = [...new Set(result.rows.map((r) => r.academicYear).filter(Boolean))];
    const existing = await prisma.historicalMarketingRecord.findMany({
      where: { institutionId, academicYear: { in: yearsInFile } },
      select: { academicYear: true, courseName: true },
    });
    const duplicateSet = new Set(existing.map((e) => `${e.academicYear}|${e.courseName}`));
    result.rows.forEach((r) => {
      if (duplicateSet.has(`${r.academicYear}|${r.courseName}`)) {
        r._errors = r._errors || [];
        r._errors.push('Duplicate: Record for this year + course already exists');
      }
    });

    res.json({
      success: true,
      data: {
        rows: result.rows,
        headers: result.headers,
        errors: result.errors,
        totalRows: result.rows.length,
      },
    });
  })
);

// POST /api/historical-marketing/import/execute – save validated rows
router.post(
  '/import/execute',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { institutionId, rows } = req.body;
    if (!institutionId || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Institution and rows are required' });
    }

    const inst = await prisma.institution.findUnique({ where: { id: institutionId } });
    if (!inst) return res.status(400).json({ success: false, message: 'Institution not found' });

    const validRows = rows.filter((r) => r.academicYear && r.courseName && (!r._errors || r._errors.length === 0));
    if (validRows.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid rows to save' });
    }

    const created = await prisma.$transaction(
      validRows.map((r) =>
        prisma.historicalMarketingRecord.create({
          data: {
            institutionId,
            academicYear: String(r.academicYear),
            courseName: String(r.courseName).trim(),
            totalInquiries: parseInt(r.totalInquiries, 10) || 0,
            totalApplications: parseInt(r.totalApplications, 10) || 0,
            confirmedAdmissions: parseInt(r.confirmedAdmissions, 10) || 0,
            maleCount: parseInt(r.maleCount, 10) || 0,
            femaleCount: parseInt(r.femaleCount, 10) || 0,
            zipCode: r.zipCode ? String(r.zipCode).trim() : null,
            marketingChannel: r.marketingChannel ? String(r.marketingChannel).trim() : null,
            marketingSpend: r.marketingSpend != null ? parseFloat(r.marketingSpend) : null,
            leadsGenerated: r.leadsGenerated != null ? parseInt(r.leadsGenerated, 10) : null,
            admissionsFromCampaign: r.admissionsFromCampaign != null ? parseInt(r.admissionsFromCampaign, 10) : null,
            status: 'DRAFT',
            sourceType: 'EXCEL',
          },
        })
      )
    );

    res.status(201).json({ success: true, data: { created: created.length, records: created } });
  })
);

// POST /api/historical-marketing/photo-ocr/preview – upload image, run OCR, return parsed rows
router.post(
  '/photo-ocr/preview',
  authenticate,
  authorize('ADMIN'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const institutionId = req.body.institutionId;
    if (!institutionId) return res.status(400).json({ success: false, message: 'Institution is required' });

    const ext = (path.extname(req.file.originalname || '') || '').toLowerCase();
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
      return res.status(400).json({ success: false, message: 'Allowed: JPG, PNG' });
    }

    let Tesseract;
    try {
      const tesseract = await import('tesseract.js');
      Tesseract = tesseract.default;
    } catch (e) {
      console.warn('tesseract.js not installed. Run: npm install tesseract.js');
      return res.status(501).json({
        success: false,
        message: 'OCR not available. Install tesseract.js: npm install tesseract.js',
        fallback: true,
      });
    }

    const result = await Tesseract.recognize(req.file.path, 'eng', { logger: () => {} });
    const text = (result.data?.text || '').trim();

    // Parse table-like structure: try to extract rows/columns
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const rows = [];
    const numRegex = /[\d,]+\.?\d*/g;

    lines.forEach((line, idx) => {
      const nums = line.match(numRegex) || [];
      const parts = line.split(/\s{2,}|\t/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 4 || nums.length >= 4) {
        rows.push({
          _row: idx + 1,
          raw: line,
          parts,
          numbers: nums.map((n) => parseFloat(n.replace(/,/g, ''))).filter((n) => !isNaN(n)),
          _confidence: 0.6,
          _errors: [],
        });
      }
    });

    if (rows.length === 0) {
      rows.push({
        _row: 1,
        raw: text.slice(0, 500),
        parts: [text.slice(0, 200)],
        numbers: [],
        _confidence: 0.3,
        _errors: ['Could not detect table structure. Please edit manually.'],
      });
    }

    res.json({
      success: true,
      data: {
        rows,
        rawText: text.slice(0, 3000),
        message: rows.length ? 'Review and correct extracted data before saving.' : 'No table structure detected. Manual entry recommended.',
      },
    });
  })
);

// POST /api/historical-marketing/photo-ocr/save – save OCR-extracted rows (after user maps/edits)
router.post(
  '/photo-ocr/save',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { institutionId, rows } = req.body;
    if (!institutionId || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Institution and rows are required' });
    }

    const inst = await prisma.institution.findUnique({ where: { id: institutionId } });
    if (!inst) return res.status(400).json({ success: false, message: 'Institution not found' });

    const validRows = rows.filter(
      (r) =>
        r.academicYear &&
        r.courseName &&
        (r.totalInquiries != null || r.totalApplications != null || r.confirmedAdmissions != null)
    );

    const created = await prisma.$transaction(
      validRows.map((r) =>
        prisma.historicalMarketingRecord.create({
          data: {
            institutionId,
            academicYear: String(r.academicYear || ''),
            courseName: String(r.courseName || '').trim(),
            totalInquiries: parseInt(r.totalInquiries, 10) || 0,
            totalApplications: parseInt(r.totalApplications, 10) || 0,
            confirmedAdmissions: parseInt(r.confirmedAdmissions, 10) || 0,
            maleCount: parseInt(r.maleCount, 10) || 0,
            femaleCount: parseInt(r.femaleCount, 10) || 0,
            zipCode: r.zipCode ? String(r.zipCode).trim() : null,
            marketingChannel: r.marketingChannel ? String(r.marketingChannel).trim() : null,
            marketingSpend: r.marketingSpend != null ? parseFloat(r.marketingSpend) : null,
            leadsGenerated: r.leadsGenerated != null ? parseInt(r.leadsGenerated, 10) : null,
            admissionsFromCampaign: r.admissionsFromCampaign != null ? parseInt(r.admissionsFromCampaign, 10) : null,
            status: 'DRAFT',
            sourceType: 'PHOTO_OCR',
          },
        })
      )
    );

    res.status(201).json({ success: true, data: { created: created.length, records: created } });
  })
);

// GET /api/historical-marketing – list records (ADMIN + COUNSELOR read-only)
router.get(
  '/',
  authenticate,
  authorize('ADMIN', 'COUNSELOR'),
  asyncHandler(async (req, res) => {
    const { institutionId, academicYear, courseName, status, page = 1, limit = 50 } = req.query;
    const where = {};
    if (institutionId) where.institutionId = institutionId;
    if (academicYear) where.academicYear = academicYear;
    if (courseName) where.courseName = { contains: courseName, mode: 'insensitive' };
    if (status) where.status = status;

    const skip = (Math.max(1, parseInt(page)) - 1) * Math.min(100, Math.max(1, parseInt(limit)));
    const take = Math.min(100, Math.max(1, parseInt(limit)));

    const [list, total] = await Promise.all([
      prisma.historicalMarketingRecord.findMany({
        where,
        include: { institution: { select: { id: true, name: true } } },
        orderBy: [{ academicYear: 'desc' }, { courseName: 'asc' }],
        skip,
        take,
      }),
      prisma.historicalMarketingRecord.count({ where }),
    ]);

    res.json({
      success: true,
      data: { list, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / take) },
    });
  })
);

// GET /api/historical-marketing/trends – 5-year trend analysis
router.get(
  '/trends',
  authenticate,
  authorize('ADMIN', 'COUNSELOR'),
  asyncHandler(async (req, res) => {
    const { institutionId } = req.query;
    const where = {};
    if (institutionId) where.institutionId = institutionId;

    const records = await prisma.historicalMarketingRecord.findMany({
      where: { ...where, status: { in: ['VERIFIED', 'LOCKED'] } },
      include: { institution: { select: { id: true, name: true } } },
    });

    const byYear = {};
    const byCourse = {};
    const byZip = {};
    const byChannel = {};

    records.forEach((r) => {
      const y = r.academicYear;
      if (!byYear[y]) byYear[y] = { inquiries: 0, applications: 0, admissions: 0, male: 0, female: 0, spend: 0, leads: 0, campaignAdm: 0 };
      byYear[y].inquiries += r.totalInquiries || 0;
      byYear[y].applications += r.totalApplications || 0;
      byYear[y].admissions += r.confirmedAdmissions || 0;
      byYear[y].male += r.maleCount || 0;
      byYear[y].female += r.femaleCount || 0;
      byYear[y].spend += r.marketingSpend || 0;
      byYear[y].leads += r.leadsGenerated || 0;
      byYear[y].campaignAdm += r.admissionsFromCampaign || 0;

      const c = r.courseName || 'Other';
      if (!byCourse[c]) byCourse[c] = { inquiries: 0, admissions: 0, years: [] };
      byCourse[c].inquiries += r.totalInquiries || 0;
      byCourse[c].admissions += r.confirmedAdmissions || 0;
      if (!byCourse[c].years.includes(y)) byCourse[c].years.push(y);

      if (r.zipCode) {
        const z = String(r.zipCode).trim();
        if (!byZip[z]) byZip[z] = { inquiries: 0, admissions: 0 };
        byZip[z].inquiries += r.totalInquiries || 0;
        byZip[z].admissions += r.confirmedAdmissions || 0;
      }

      if (r.marketingChannel) {
        const ch = r.marketingChannel.trim();
        if (!byChannel[ch]) byChannel[ch] = { spend: 0, leads: 0, admissions: 0 };
        byChannel[ch].spend += r.marketingSpend || 0;
        byChannel[ch].leads += r.leadsGenerated || 0;
        byChannel[ch].admissions += r.admissionsFromCampaign || 0;
      }
    });

    const years = Object.keys(byYear).sort();
    const yearTrends = years.map((y) => ({
      year: y,
      ...byYear[y],
      conversionRate: byYear[y].applications ? ((byYear[y].admissions / byYear[y].applications) * 100).toFixed(1) : 0,
    }));

    const courseTrends = Object.entries(byCourse)
      .map(([name, d]) => ({
        name,
        inquiries: d.inquiries,
        admissions: d.admissions,
        yearCount: d.years.length,
      }))
      .sort((a, b) => b.inquiries - a.inquiries)
      .slice(0, 20);

    const zipTrends = Object.entries(byZip)
      .map(([zip, d]) => ({ zip, inquiries: d.inquiries, admissions: d.admissions }))
      .sort((a, b) => b.inquiries - a.inquiries)
      .slice(0, 20);

    const channelROI = Object.entries(byChannel).map(([name, d]) => ({
      name,
      spend: d.spend,
      leads: d.leads,
      admissions: d.admissions,
      roi: d.spend > 0 && d.admissions > 0 ? (d.admissions / (d.spend / 1000)).toFixed(2) : null,
    }));

    function cagr(startVal, endVal, n) {
      if (!startVal || startVal <= 0 || n <= 0) return null;
      return (((endVal / startVal) ** (1 / n) - 1) * 100).toFixed(1);
    }

    const cagrInquiry = years.length >= 2 ? cagr(byYear[years[0]]?.inquiries, byYear[years[years.length - 1]]?.inquiries, years.length - 1) : null;
    const cagrAdmission = years.length >= 2 ? cagr(byYear[years[0]]?.admissions, byYear[years[years.length - 1]]?.admissions, years.length - 1) : null;

    res.json({
      success: true,
      data: {
        yearTrends,
        courseTrends,
        zipTrends,
        channelROI,
        cagrInquiry,
        cagrAdmission,
        totalYears: years.length,
      },
    });
  })
);

// GET /api/historical-marketing/recommendations – marketing insights
router.get(
  '/recommendations',
  authenticate,
  authorize('ADMIN', 'COUNSELOR'),
  asyncHandler(async (req, res) => {
    const { institutionId } = req.query;
    const where = {};
    if (institutionId) where.institutionId = institutionId;

    const records = await prisma.historicalMarketingRecord.findMany({
      where: { ...where, status: { in: ['VERIFIED', 'LOCKED'] } },
    });

    const byZip = {};
    const byCourse = {};
    const byChannel = {};
    const byYear = {};
    records.forEach((r) => {
      if (r.zipCode) {
        const z = String(r.zipCode).trim();
        byZip[z] = (byZip[z] || 0) + (r.totalInquiries || 0);
      }
      byCourse[r.courseName || ''] = (byCourse[r.courseName || ''] || 0) + (r.totalInquiries || 0);
      if (r.marketingChannel) byChannel[r.marketingChannel] = (byChannel[r.marketingChannel] || 0) + (r.admissionsFromCampaign || 0);
      byYear[r.academicYear] = byYear[r.academicYear] || { male: 0, female: 0 };
      byYear[r.academicYear].male += r.maleCount || 0;
      byYear[r.academicYear].female += r.femaleCount || 0;
    });

    const recommendations = [];

    const topZip = Object.entries(byZip).sort((a, b) => b[1] - a[1])[0];
    if (topZip) {
      const avgZip = Object.values(byZip).reduce((a, b) => a + b, 0) / Object.keys(byZip).length;
      const pct = avgZip > 0 ? ((topZip[1] / avgZip - 1) * 100).toFixed(0) : 0;
      recommendations.push({
        type: 'zip',
        text: `Focus advertising in Zip Code ${topZip[0]} – ${Math.abs(pct)}% ${pct > 0 ? 'higher' : 'lower'} inquiry volume than average.`,
        data: { zip: topZip[0], inquiries: topZip[1] },
      });
    }

    const topCourse = Object.entries(byCourse).filter(([n]) => n).sort((a, b) => b[1] - a[1])[0];
    if (topCourse) {
      recommendations.push({
        type: 'course',
        text: `${topCourse[0]} shows highest inquiry volume. Consider increasing digital marketing for this course.`,
        data: { course: topCourse[0], inquiries: topCourse[1] },
      });
    }

    const years = Object.keys(byYear).sort();
    if (years.length >= 2) {
      const last = byYear[years[years.length - 1]];
      const prev = byYear[years[years.length - 2]];
      const femaleGrowth = prev?.female ? ((last.female - prev.female) / prev.female * 100).toFixed(0) : null;
      if (femaleGrowth && Math.abs(femaleGrowth) > 5) {
        recommendations.push({
          type: 'gender',
          text: `Female admissions ${femaleGrowth > 0 ? 'rising' : 'declining'} (${femaleGrowth}% YoY). ${femaleGrowth > 0 ? 'Tailor campaigns to female students.' : 'Review outreach to female demographics.'}`,
          data: { femaleGrowth },
        });
      }
    }

    const lowROI = Object.entries(byChannel).filter(([, adm]) => adm < 5);
    if (lowROI.length) {
      recommendations.push({
        type: 'channel',
        text: `Consider reducing spend on low-conversion channels: ${lowROI.map(([c]) => c).join(', ')}.`,
        data: { channels: lowROI.map(([c]) => c) },
      });
    }

    res.json({ success: true, data: { recommendations } });
  })
);

// GET /api/historical-marketing/dashboard – summary for Admin/Counselor panels
router.get(
  '/dashboard',
  authenticate,
  authorize('ADMIN', 'COUNSELOR'),
  asyncHandler(async (req, res) => {
    const { institutionId } = req.query;
    const where = {};
    if (institutionId) where.institutionId = institutionId;

    const records = await prisma.historicalMarketingRecord.findMany({
      where: { ...where, status: { in: ['VERIFIED', 'LOCKED'] } },
    });

    const byYear = {};
    const byCourse = {};
    const byZip = {};
    records.forEach((r) => {
      byYear[r.academicYear] = (byYear[r.academicYear] || 0) + r.confirmedAdmissions;
      byCourse[r.courseName] = (byCourse[r.courseName] || 0) + r.totalInquiries;
      if (r.zipCode) byZip[r.zipCode] = (byZip[r.zipCode] || 0) + r.totalInquiries;
    });

    const topCourse = Object.entries(byCourse).sort((a, b) => b[1] - a[1])[0];
    const topZip = Object.entries(byZip).sort((a, b) => b[1] - a[1])[0];
    const yearData = Object.entries(byYear).sort((a, b) => a[0].localeCompare(b[0])).map(([y, v]) => ({ year: y, admissions: v }));

    res.json({
      success: true,
      data: {
        topGrowingCourse: topCourse ? { name: topCourse[0], inquiries: topCourse[1] } : null,
        highestInquiryZip: topZip ? { zip: topZip[0], inquiries: topZip[1] } : null,
        yearTrend: yearData,
        totalRecords: records.length,
      },
    });
  })
);

// PUT /api/historical-marketing/:id/status
router.put(
  '/:id/status',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['DRAFT', 'VERIFIED', 'LOCKED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const record = await prisma.historicalMarketingRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    const updated = await prisma.historicalMarketingRecord.update({
      where: { id: req.params.id },
      data: { status },
      include: { institution: { select: { name: true } } },
    });
    res.json({ success: true, data: updated });
  })
);

// DELETE /api/historical-marketing/:id
router.delete(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const record = await prisma.historicalMarketingRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    if (record.status === 'LOCKED') return res.status(403).json({ success: false, message: 'Locked records cannot be deleted' });
    await prisma.historicalMarketingRecord.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Deleted' });
  })
);

// GET /api/historical-marketing/export/excel
router.get(
  '/export/excel',
  authenticate,
  authorize('ADMIN', 'COUNSELOR'),
  asyncHandler(async (req, res) => {
    const { institutionId } = req.query;
    const where = {};
    if (institutionId) where.institutionId = institutionId;

    const records = await prisma.historicalMarketingRecord.findMany({
      where,
      include: { institution: { select: { name: true } } },
      orderBy: [{ academicYear: 'desc' }, { courseName: 'asc' }],
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Historical Marketing');
    sheet.addRow([
      'Academic Year',
      'Institution',
      'Course',
      'Inquiries',
      'Applications',
      'Admissions',
      'Male',
      'Female',
      'Zip',
      'Channel',
      'Spend',
      'Leads',
      'Campaign Adm',
      'Status',
    ]);
    records.forEach((r) => {
      sheet.addRow([
        r.academicYear,
        r.institution?.name || '',
        r.courseName,
        r.totalInquiries,
        r.totalApplications,
        r.confirmedAdmissions,
        r.maleCount,
        r.femaleCount,
        r.zipCode || '',
        r.marketingChannel || '',
        r.marketingSpend || '',
        r.leadsGenerated || '',
        r.admissionsFromCampaign || '',
        r.status,
      ]);
    });
    sheet.columns.forEach((col) => { col.width = 16; });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=historical_marketing_${Date.now()}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

// GET /api/historical-marketing/export/pdf – HTML report (print to PDF)
router.get(
  '/export/pdf',
  authenticate,
  authorize('ADMIN', 'COUNSELOR'),
  asyncHandler(async (req, res) => {
    const { institutionId } = req.query;
    const where = {};
    if (institutionId) where.institutionId = institutionId;

    const records = await prisma.historicalMarketingRecord.findMany({
      where: { ...where, status: { in: ['VERIFIED', 'LOCKED'] } },
      include: { institution: { select: { name: true } } },
      orderBy: [{ academicYear: 'desc' }, { courseName: 'asc' }],
    });

    const [trendsRes, recRes] = await Promise.all([
      prisma.historicalMarketingRecord.groupBy({
        where: { ...where, status: { in: ['VERIFIED', 'LOCKED'] } },
        by: ['academicYear'],
        _sum: { totalInquiries: true, confirmedAdmissions: true },
      }),
      (async () => {
        const recs = await prisma.historicalMarketingRecord.findMany({ where: { ...where, status: { in: ['VERIFIED', 'LOCKED'] } } });
        const byZip = {};
        const byCourse = {};
        recs.forEach((r) => {
          if (r.zipCode) byZip[r.zipCode] = (byZip[r.zipCode] || 0) + (r.totalInquiries || 0);
          byCourse[r.courseName] = (byCourse[r.courseName] || 0) + (r.totalInquiries || 0);
        });
        return { byZip: Object.entries(byZip).sort((a, b) => b[1] - a[1]).slice(0, 10), byCourse: Object.entries(byCourse).sort((a, b) => b[1] - a[1]).slice(0, 10) };
      })(),
    ]);

    const yearData = trendsRes.map((g) => ({ year: g.academicYear, inquiries: g._sum.totalInquiries || 0, admissions: g._sum.confirmedAdmissions || 0 })).sort((a, b) => a.year.localeCompare(b.year));

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Historical Marketing Report</title><style>body{font-family:sans-serif;padding:24px;max-width:800px;margin:0 auto}h1{color:#333;border-bottom:2px solid #6366f1;padding-bottom:8px}h2{color:#555;margin-top:24px}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f3f4f6}.rec{background:#f0fdf4;padding:8px;margin:4px 0;border-left:4px solid #10b981}</style></head><body>
<h1>Historical Admissions & Marketing Intelligence Report</h1>
<p>Generated: ${new Date().toISOString().split('T')[0]}</p>
<h2>5-Year Admission Trend</h2>
<table><tr><th>Year</th><th>Inquiries</th><th>Admissions</th></tr>
${yearData.map((r) => `<tr><td>${r.year}</td><td>${r.inquiries}</td><td>${r.admissions}</td></tr>`).join('')}
</table>
<h2>Top Courses by Inquiries</h2>
<table><tr><th>Course</th><th>Inquiries</th></tr>
${recRes.byCourse.map(([c, v]) => `<tr><td>${c}</td><td>${v}</td></tr>`).join('')}
</table>
<h2>Top Zip Codes</h2>
<table><tr><th>Zip</th><th>Inquiries</th></tr>
${recRes.byZip.map(([z, v]) => `<tr><td>${z}</td><td>${v}</td></tr>`).join('')}
</table>
<h2>Recommendations</h2>
${recRes.byZip[0] ? `<p class="rec">• Focus advertising in Zip Code ${recRes.byZip[0][0]} – highest inquiry volume.</p>` : ''}
${recRes.byCourse[0] ? `<p class="rec">• ${recRes.byCourse[0][0]} shows highest inquiry volume – increase digital marketing.</p>` : ''}
<p><em>Use browser Print (Ctrl+P) → Save as PDF to download.</em></p>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename=historical_marketing_report.html');
    res.send(html);
  })
);

// GET /api/historical-marketing/options – institutions for dropdown (ADMIN + COUNSELOR)
router.get(
  '/options',
  authenticate,
  authorize('ADMIN', 'COUNSELOR'),
  asyncHandler(async (req, res) => {
    const institutions = await prisma.institution.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: { institutions } });
  })
);

export default router;
