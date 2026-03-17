/**
 * Historical Data & Verification
 * Admin uploads → validate → pending → verify → counselor sees only verified
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, '..', 'uploads', 'historical-verification');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_EXT = /\.(xlsx|xls|csv|pdf|docx|doc)$/i;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.xlsx';
    const base = (file.originalname || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.[^.]+$/, '') || 'file';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.xlsx').toLowerCase();
    if (ALLOWED_EXT.test(ext)) return cb(null, true);
    cb(new Error('Invalid file type. Allowed: .xlsx, .xls, .csv, .pdf, .docx, .doc'));
  },
});

const DATA_TYPES = ['admissions', 'leads', 'fees', 'feedback'];

async function parseExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  const rows = [];
  let headers = [];
  sheet.eachRow((row, rowNumber) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber] = cell.value != null ? String(cell.value) : '';
    });
    const filtered = values.filter((v) => v !== undefined && v !== null).map((v) => String(v ?? '').trim());
    if (rowNumber === 1 && filtered.length) {
      headers = filtered.map((v, i) => (v ? v : `Column_${i + 1}`));
    }
    if (rowNumber > 1 && headers.length) {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = filtered[i] ?? ''; });
      if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
    }
  });
  return { headers, rows };
}

async function parseCsv(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.csv.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  const rows = [];
  let headers = [];
  sheet.eachRow((row, rowNumber) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber] = cell.value != null ? String(cell.value) : '';
    });
    const filtered = values.filter((v) => v !== undefined && v !== null).map((v) => String(v ?? '').trim());
    if (rowNumber === 1 && filtered.length) {
      headers = filtered.map((v, i) => (v ? v : `Column_${i + 1}`));
    }
    if (rowNumber > 1 && headers.length) {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = filtered[i] ?? ''; });
      if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
    }
  });
  return { headers, rows };
}

async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer);
  return (data.text || '').trim();
}

async function extractWordText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return (result.value || '').trim();
}

async function parseFile(filePath, ext) {
  if (ext === 'csv') return parseCsv(filePath);
  if (['xlsx', 'xls'].includes(ext)) return parseExcel(filePath);
  if (ext === 'pdf') {
    try {
      const text = await extractPdfText(filePath);
      if (!text) return { headers: ['content'], rows: [{ content: '(No text extracted from PDF)' }], parseError: 'PDF may be scanned/image-only' };
      return { headers: ['content'], rows: [{ content: text }] };
    } catch (e) {
      return { headers: ['content'], rows: [{ content: `(Failed to parse PDF: ${e.message})` }], parseError: e.message };
    }
  }
  if (['docx', 'doc'].includes(ext)) {
    try {
      const text = await extractWordText(filePath);
      if (!text) return { headers: ['content'], rows: [{ content: '(No text extracted from document)' }], parseError: 'Document may be empty' };
      return { headers: ['content'], rows: [{ content: text }] };
    } catch (e) {
      return { headers: ['content'], rows: [{ content: `(Failed to parse document: ${e.message})` }], parseError: e.message };
    }
  }
  return { headers: [], rows: [], parseError: 'Unsupported file type' };
}

const router = express.Router();

// POST /api/historical/upload
router.post(
  '/upload',
  authenticate,
  authorize('ADMIN'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { institutionId, academicYear, dataType, description } = req.body;
    const file = req.file;

    if (!institutionId) return res.status(400).json({ success: false, message: 'Institution is required' });
    if (!academicYear) return res.status(400).json({ success: false, message: 'Academic year is required' });
    if (!dataType || !DATA_TYPES.includes(dataType)) {
      return res.status(400).json({ success: false, message: `Data type must be one of: ${DATA_TYPES.join(', ')}` });
    }
    if (!file) return res.status(400).json({ success: false, message: 'File is required' });

    const inst = await prisma.institution.findUnique({ where: { id: institutionId } });
    if (!inst) return res.status(400).json({ success: false, message: 'Institution not found' });

    const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '') || 'xlsx';
    const fileUrl = `/uploads/historical-verification/${path.basename(file.path)}`;

    let rows = [];
    let parseError = null;
    if (['xlsx', 'xls', 'csv', 'pdf', 'docx', 'doc'].includes(ext)) {
      try {
        const parsed = await parseFile(file.path, ext);
        rows = (parsed.rows || []).filter((r) => Object.values(r).some((v) => v != null && String(v).trim()));
        if (parsed.parseError) parseError = parsed.parseError;
      } catch (e) {
        parseError = e.message || 'Parse failed';
      }
    }

    const uploadRecord = await prisma.$transaction(async (tx) => {
      const u = await tx.historicalUpload.create({
        data: {
          institutionId,
          academicYear: String(academicYear),
          dataType,
          description: description || null,
          fileUrl,
          fileName: file.originalname || path.basename(file.path),
          fileSize: file.size,
          status: 'PENDING',
          uploadedById: req.userId,
        },
        include: {
          institution: { select: { id: true, name: true } },
          uploadedBy: { select: { id: true, username: true } },
        },
      });
      if (rows.length > 0) {
        await tx.historicalRecord.createMany({
          data: rows.map((r) => ({ uploadId: u.id, recordData: r })),
        });
      }
      return u;
    });

    const recordCount = await prisma.historicalRecord.count({ where: { uploadId: uploadRecord.id } });

    res.status(201).json({
      success: true,
      data: {
        upload: uploadRecord,
        recordCount,
        parseError: parseError || null,
        preview: rows.slice(0, 20),
        totalRows: rows.length,
      },
    });
  })
);

// GET /api/historical/pending
router.get(
  '/pending',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const uploads = await prisma.historicalUpload.findMany({
      where: { status: 'PENDING' },
      include: {
        institution: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, username: true } },
        _count: { select: { records: true } },
      },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json({ success: true, data: uploads });
  })
);

// GET /api/historical/all – for admin (all statuses, filterable)
router.get(
  '/all',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const where = status ? { status } : {};
    const uploads = await prisma.historicalUpload.findMany({
      where,
      include: {
        institution: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, username: true } },
        verifiedBy: { select: { id: true, username: true } },
        _count: { select: { records: true } },
      },
      orderBy: { uploadedAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: uploads });
  })
);

// GET /api/historical/counselor-data – must be BEFORE /:id (else "counselor-data" matches :id → 403)
router.get(
  '/counselor-data',
  authenticate,
  authorize('COUNSELOR'),
  asyncHandler(async (req, res) => {
    const profile = await prisma.counselorProfile.findFirst({ where: { userId: req.userId }, select: { id: true } });
    if (!profile) return res.status(403).json({ success: false, message: 'Counselor profile not found' });
    // Counselors see all verified historical data (no institution filter)
    const uploads = await prisma.historicalUpload.findMany({
      where: { status: 'VERIFIED' },
      include: {
        institution: { select: { id: true, name: true } },
        _count: { select: { records: true } },
      },
      orderBy: [{ academicYear: 'desc' }, { uploadedAt: 'desc' }],
    });
    const yearCounts = {};
    for (const u of uploads) {
      const yr = u.academicYear;
      const c = u._count?.records ?? 0;
      yearCounts[yr] = (yearCounts[yr] || 0) + c;
    }
    const years = Object.keys(yearCounts).sort();
    const growth = [];
    for (let i = 1; i < years.length; i++) {
      const prev = yearCounts[years[i - 1]] || 0;
      const curr = yearCounts[years[i]] || 0;
      const pct = prev > 0 ? ((curr - prev) / prev) * 100 : (curr > 0 ? 100 : 0);
      growth.push({ year: years[i], prevYear: years[i - 1], prevCount: prev, count: curr, growthPercent: Math.round(pct * 10) / 10 });
    }
    res.json({ success: true, data: { uploads, yearCounts, growth } });
  })
);

// GET /api/historical/counselor-view/:id – counselor views verified upload records (must be before /:id)
router.get(
  '/counselor-view/:id',
  authenticate,
  authorize('COUNSELOR'),
  asyncHandler(async (req, res) => {
    const upload = await prisma.historicalUpload.findFirst({
      where: { id: req.params.id, status: 'VERIFIED' },
      include: {
        institution: { select: { id: true, name: true } },
        records: { orderBy: { createdAt: 'asc' }, take: 500 },
      },
    });
    if (!upload) return res.status(404).json({ success: false, message: 'Upload not found or not verified' });
    res.json({ success: true, data: upload });
  })
);

// GET /api/historical/:id
router.get(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const upload = await prisma.historicalUpload.findUnique({
      where: { id: req.params.id },
      include: {
        institution: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, username: true } },
        verifiedBy: { select: { id: true, username: true } },
        records: { take: 100, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!upload) return res.status(404).json({ success: false, message: 'Upload not found' });
    res.json({ success: true, data: upload });
  })
);

// PUT /api/historical/:id/approve
router.put(
  '/:id/approve',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const upload = await prisma.historicalUpload.findUnique({ where: { id: req.params.id } });
    if (!upload) return res.status(404).json({ success: false, message: 'Upload not found' });
    if (upload.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Cannot approve: status is ${upload.status}` });
    }
    const updated = await prisma.historicalUpload.update({
      where: { id: req.params.id },
      data: { status: 'VERIFIED', verifiedById: req.userId, verifiedAt: new Date(), rejectionReason: null },
      include: {
        institution: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, username: true } },
        verifiedBy: { select: { id: true, username: true } },
      },
    });
    res.json({ success: true, data: updated });
  })
);

// PUT /api/historical/:id/reject
router.put(
  '/:id/reject',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { rejectionReason } = req.body;
    const upload = await prisma.historicalUpload.findUnique({ where: { id: req.params.id } });
    if (!upload) return res.status(404).json({ success: false, message: 'Upload not found' });
    if (upload.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Cannot reject: status is ${upload.status}` });
    }
    const updated = await prisma.historicalUpload.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', rejectionReason: rejectionReason || 'No reason provided' },
      include: {
        institution: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, username: true } },
      },
    });
    res.json({ success: true, data: updated });
  })
);

export default router;
