/**
 * Historical Admissions entries (Admissions / Marketing / Publicity): list, options, CRUD, lock/unlock, documents upload
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, '..', 'uploads', 'historical-admissions');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '';
    const base = (file.originalname || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.[^.]+$/, '') || 'file';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 9) + '-' + base + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const router = express.Router();

// GET /api/historical-admissions/options — institutions, courses (exclude placeholder), academic years
router.get(
  '/options',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const [institutions, courses] = await Promise.all([
      prisma.institution.findMany({
        where: { isActive: true },
        select: { id: true, name: true, type: true },
        orderBy: { name: 'asc' },
      }),
      prisma.course.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true, institutionId: true },
        orderBy: [{ institutionId: 'asc' }, { name: 'asc' }],
      }),
    ]);
    const years = await prisma.historicalAdmission.findMany({
      distinct: ['academicYear'],
      select: { academicYear: true },
      orderBy: { academicYear: 'desc' },
    });
    res.json({
      success: true,
      data: {
        institutions,
        courses,
        academicYears: years.map((y) => y.academicYear).filter(Boolean),
      },
    });
  })
);

// GET /api/historical-admissions — list (exclude placeholder by default)
router.get(
  '/',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { institutionId, courseId, academicYear, category, status, search, sort = 'updatedAt', order = 'desc', page = 1, limit = 20 } = req.query;
    const where = { isPlaceholder: false };
    if (institutionId) where.institutionId = institutionId;
    if (courseId) where.courseId = courseId;
    if (academicYear) where.academicYear = academicYear;
    if (category) where.category = category;
    if (status) where.status = status;
    if (search && String(search).trim()) {
      where.OR = [
        { title: { contains: String(search).trim(), mode: 'insensitive' } },
        { description: { contains: String(search).trim(), mode: 'insensitive' } },
      ];
    }
    const skip = (Math.max(1, parseInt(page)) - 1) * Math.min(100, Math.max(1, parseInt(limit)));
    const take = Math.min(100, Math.max(1, parseInt(limit)));
    const validSort = ['updatedAt', 'createdAt', 'academicYear', 'title', 'status', 'category'].includes(sort) ? sort : 'updatedAt';
    const [list, total] = await Promise.all([
      prisma.historicalAdmission.findMany({
        where,
        include: {
          institution: { select: { id: true, name: true } },
          course: { select: { id: true, name: true, code: true } },
          images: { select: { id: true, fileName: true, fileUrl: true, fileType: true, sortOrder: true } },
        },
        orderBy: { [validSort]: order === 'asc' ? 'asc' : 'desc' },
        skip,
        take,
      }),
      prisma.historicalAdmission.count({ where }),
    ]);
    res.json({
      success: true,
      data: { list, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / take) },
    });
  })
);

// GET /api/historical-admissions/:id
router.get(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const record = await prisma.historicalAdmission.findUnique({
      where: { id: req.params.id },
      include: {
        institution: { select: { id: true, name: true, type: true } },
        course: { select: { id: true, name: true, code: true } },
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!record) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: record });
  })
);

// POST /api/historical-admissions — create
router.post(
  '/',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { institutionId, courseId, academicYear, category, status, title, description, applicationData, marketingData, isPlaceholder } = req.body;
    if (!institutionId || !academicYear || !category) {
      return res.status(400).json({ success: false, message: 'institutionId, academicYear, and category are required' });
    }
    const validCategory = ['Admissions', 'Marketing', 'Publicity'].includes(category) ? category : 'Admissions';
    const validStatus = ['DRAFT', 'SUBMITTED', 'VERIFIED', 'LOCKED'].includes(status) ? status : 'DRAFT';
    const record = await prisma.historicalAdmission.create({
      data: {
        institutionId,
        courseId: courseId || null,
        academicYear: String(academicYear),
        category: validCategory,
        status: validStatus,
        title: title || null,
        description: description || null,
        applicationData: applicationData || null,
        marketingData: marketingData || null,
        isPlaceholder: !!isPlaceholder,
      },
      include: {
        institution: { select: { id: true, name: true } },
        course: { select: { id: true, name: true } },
        images: true,
      },
    });
    res.status(201).json({ success: true, data: record });
  })
);

// PUT /api/historical-admissions/:id — update
router.put(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.historicalAdmission.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    if (existing.status === 'LOCKED') {
      return res.status(400).json({ success: false, message: 'Cannot edit a locked entry. Unlock first.' });
    }
    const { courseId, academicYear, category, status, title, description, applicationData, marketingData } = req.body;
    const validStatus = ['DRAFT', 'SUBMITTED', 'VERIFIED', 'LOCKED'].includes(status) ? status : existing.status;
    const record = await prisma.historicalAdmission.update({
      where: { id: req.params.id },
      data: {
        ...(courseId !== undefined && { courseId: courseId || null }),
        ...(academicYear !== undefined && { academicYear: String(academicYear) }),
        ...(category !== undefined && { category: ['Admissions', 'Marketing', 'Publicity'].includes(category) ? category : existing.category }),
        ...(status !== undefined && { status: validStatus }),
        ...(title !== undefined && { title: title || null }),
        ...(description !== undefined && { description: description || null }),
        ...(applicationData !== undefined && { applicationData }),
        ...(marketingData !== undefined && { marketingData }),
        updatedAt: new Date(),
      },
      include: {
        institution: { select: { id: true, name: true } },
        course: { select: { id: true, name: true } },
        images: true,
      },
    });
    res.json({ success: true, data: record });
  })
);

// POST /api/historical-admissions/:id/lock — only when VERIFIED
router.post(
  '/:id/lock',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.historicalAdmission.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    if (existing.status !== 'VERIFIED') {
      return res.status(400).json({ success: false, message: 'Only entries with status VERIFIED can be locked.' });
    }
    const record = await prisma.historicalAdmission.update({
      where: { id: req.params.id },
      data: { status: 'LOCKED', updatedAt: new Date() },
      include: { institution: { select: { id: true, name: true } }, course: { select: { id: true, name: true } }, images: true },
    });
    res.json({ success: true, data: record });
  })
);

// POST /api/historical-admissions/:id/unlock
router.post(
  '/:id/unlock',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.historicalAdmission.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    const record = await prisma.historicalAdmission.update({
      where: { id: req.params.id },
      data: { status: 'VERIFIED', updatedAt: new Date() },
      include: { institution: { select: { id: true, name: true } }, course: { select: { id: true, name: true } }, images: true },
    });
    res.json({ success: true, data: record });
  })
);

// POST /api/historical-admissions/:id/documents — documents-only upload (any file type)
router.post(
  '/:id/documents',
  authenticate,
  authorize('ADMIN'),
  upload.array('files', 20),
  asyncHandler(async (req, res) => {
    const admission = await prisma.historicalAdmission.findUnique({ where: { id: req.params.id }, include: { images: true } });
    if (!admission) return res.status(404).json({ success: false, message: 'Not found' });
    if (admission.status === 'LOCKED') {
      return res.status(400).json({ success: false, message: 'Cannot add documents to a locked entry.' });
    }
    const files = req.files || [];
    const maxOrder = admission.images.length ? Math.max(...admission.images.map((i) => i.sortOrder)) : -1;
    const created = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '') || 'bin';
      const fileUrl = `/uploads/historical-admissions/${path.basename(file.path)}`;
      const img = await prisma.historicalAdmissionImage.create({
        data: {
          historicalAdmissionId: req.params.id,
          fileName: file.originalname || path.basename(file.path),
          fileUrl,
          fileType: ext,
          fileSize: file.size || null,
          sortOrder: maxOrder + 1 + i,
        },
      });
      created.push(img);
    }
    res.status(201).json({ success: true, data: { uploaded: created } });
  })
);

// Preview/Execute for Admissions category (placeholder endpoints – can parse Excel and return rows)
router.post(
  '/preview',
  authenticate,
  authorize('ADMIN'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
    const ext = path.extname(req.file.originalname || '').toLowerCase().replace('.', '');
    if (!['xlsx', 'xls'].includes(ext)) {
      return res.json({ success: true, data: { rows: [], headers: [], message: 'Only Excel files are previewed; use Import as attachments for other types.' } });
    }
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.json({ success: true, data: { rows: [], headers: [] } });
    const rows = [];
    let headers = [];
    sheet.eachRow((row, rowNumber) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        values[colNumber] = cell.value != null ? String(cell.value) : '';
      });
      if (rowNumber === 1 && values.length) {
        headers = values.slice(1).map((v, i) => (v && String(v).trim() ? String(v).trim() : `Column_${i + 1}`));
      }
      if (rowNumber > 1 && values.length && headers.length) {
        const obj = {};
        values.forEach((v, i) => {
          const key = headers[i - 1] || `col_${i}`;
          obj[key] = v;
        });
        rows.push(obj);
      }
    });
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.json({ success: true, data: { rows: rows.slice(0, 100), headers } });
  })
);

export default router;
