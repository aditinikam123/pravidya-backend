/**
 * Historical Admissions & Publicity – file upload, list, verify, lock
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import pdf from 'pdf-parse';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, '..', 'uploads', 'historical-files');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_EXT = /\.(xlsx|xls|pdf|docx|doc|jpg|jpeg|png)$/i;
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '';
    const base = (file.originalname || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.[^.]+$/, '') || 'file';
    const unique = Date.now() + '-' + Math.random().toString(36).slice(2, 9) + '-' + base + ext;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ext || ALLOWED_EXT.test(ext)) return cb(null, true);
    cb(new Error('Invalid file type. Allowed: .xlsx, .xls, .pdf, .docx, .doc, .jpg, .jpeg, .png'));
  },
});

const router = express.Router();

async function parseExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
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
      const obj = { _row: rowNumber };
      values.forEach((v, i) => {
        const key = headers[i - 1] || `col_${i}`;
        obj[key] = v;
      });
      rows.push(obj);
    }
  });
  return rows.slice(0, 500);
}

async function extractPdfText(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  return data.text || '';
}

async function extractWordText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

// POST /api/historical-files/upload – multi-file upload
router.post(
  '/upload',
  authenticate,
  authorize('ADMIN'),
  upload.array('files', 20),
  asyncHandler(async (req, res) => {
    const institutionId = req.body.institutionId;
    const academicYear = req.body.academicYear || null;
    const category = req.body.category || 'Both';
    const description = req.body.description || null;

    if (!institutionId) {
      return res.status(400).json({ success: false, message: 'Institution is required' });
    }
    const inst = await prisma.institution.findUnique({ where: { id: institutionId } });
    if (!inst) {
      return res.status(400).json({ success: false, message: 'Institution not found' });
    }

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const created = [];
    for (const file of files) {
      const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '') || 'unknown';
      const fileType = ext;
      const fileUrl = `/uploads/historical-files/${path.basename(file.path)}`;
      const fileSize = file.size || null;

      let parsedData = null;
      let extractedText = null;

      try {
        if (['xlsx', 'xls'].includes(ext)) {
          parsedData = await parseExcel(file.path);
        } else if (ext === 'pdf') {
          extractedText = await extractPdfText(file.path);
        } else if (['docx', 'doc'].includes(ext)) {
          extractedText = await extractWordText(file.path);
        }
      } catch (e) {
        console.warn('Parse/extract warning for', file.originalname, e.message);
      }

      const record = await prisma.historicalFile.create({
        data: {
          institutionId,
          fileName: file.originalname || path.basename(file.path),
          fileType,
          fileUrl,
          fileSize,
          academicYear,
          category,
          description,
          parsedData: parsedData ? JSON.parse(JSON.stringify(parsedData)) : null,
          extractedText: extractedText ? extractedText.slice(0, 100000) : null,
          status: 'PENDING',
          uploadedById: req.userId,
        },
        include: {
          institution: { select: { id: true, name: true } },
          uploadedBy: { select: { id: true, username: true } },
        },
      });
      created.push(record);
    }

    res.status(201).json({ success: true, data: { files: created } });
  })
);

// GET /api/historical-files
router.get(
  '/',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { institutionId, status, category, page = 1, limit = 50 } = req.query;
    const where = {};
    if (institutionId) where.institutionId = institutionId;
    if (status) where.status = status;
    if (category) where.category = category;

    const skip = (Math.max(1, parseInt(page)) - 1) * Math.min(100, Math.max(1, parseInt(limit)));
    const take = Math.min(100, Math.max(1, parseInt(limit)));

    const [list, total] = await Promise.all([
      prisma.historicalFile.findMany({
        where,
        include: {
          institution: { select: { id: true, name: true } },
          uploadedBy: { select: { id: true, username: true } },
        },
        orderBy: { uploadedAt: 'desc' },
        skip,
        take,
      }),
      prisma.historicalFile.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        files: list,
        total,
        page: parseInt(page) || 1,
        totalPages: Math.ceil(total / take),
      },
    });
  })
);

// GET /api/historical-files/stats – for dashboard
router.get(
  '/stats',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const [totalFiles, totalInstitutions, totalRecords, pendingCount, verifiedCount] = await Promise.all([
      prisma.historicalFile.count(),
      prisma.historicalFile.groupBy({ by: ['institutionId'], _count: true }).then((g) => g.length),
      prisma.historicalFile.count(),
      prisma.historicalFile.count({ where: { status: 'PENDING' } }),
      prisma.historicalFile.count({ where: { status: 'VERIFIED' } }),
    ]);

    const [recentUploads, categoryDistribution, institutionGroups] = await Promise.all([
      prisma.historicalFile.findMany({
        take: 10,
        orderBy: { uploadedAt: 'desc' },
        include: {
          institution: { select: { name: true } },
          uploadedBy: { select: { username: true } },
        },
      }),
      prisma.historicalFile.groupBy({ by: ['category'], _count: { id: true } }),
      prisma.historicalFile.groupBy({
        by: ['institutionId'],
        _count: { id: true },
      }),
    ]);

    const institutionIds = institutionGroups.map((g) => g.institutionId);
    const institutionNames = institutionIds.length
      ? await prisma.institution.findMany({
          where: { id: { in: institutionIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameMap = new Map(institutionNames.map((i) => [i.id, i.name]));
    const institutionWise = institutionGroups.map((g) => ({
      name: nameMap.get(g.institutionId) || 'Unknown',
      count: g._count.id,
    }));

    res.json({
      success: true,
      data: {
        totalFiles,
        totalInstitutions,
        totalRecords,
        pendingVerification: pendingCount,
        verifiedRecords: verifiedCount,
        recentUploads,
        categoryDistribution: categoryDistribution.map((c) => ({ category: c.category, count: c._count.id })),
        institutionWise,
      },
    });
  })
);

// GET /api/historical-files/analytics – for analytics page (year-wise, institution-wise from parsedData)
router.get(
  '/analytics',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { institutionId, year } = req.query;
    const where = {};
    if (institutionId) where.institutionId = institutionId;
    where.parsedData = { not: null };
    where.status = { in: ['VERIFIED', 'LOCKED'] };

    const files = await prisma.historicalFile.findMany({
      where,
      select: { id: true, institutionId: true, fileName: true, category: true, parsedData: true, institution: { select: { name: true } } },
    });

    const yearTrend = {};
    const institutionCount = {};
    const institutionAdmissions = {};
    const courseCount = {};
    const categoryCount = { Marketing: 0, Publicity: 0, Both: 0 };

    files.forEach((f) => {
      categoryCount[f.category] = (categoryCount[f.category] || 0) + 1;
      const instName = f.institution?.name || 'Unknown';
      institutionCount[instName] = (institutionCount[instName] || 0) + 1;
      const data = f.parsedData;
      if (Array.isArray(data)) {
        data.forEach((row) => {
          const y = row.Year ?? row.year ?? row.col_1;
          const course = row.Course ?? row.course ?? row.col_2;
          const adm = row.Admissions ?? row.admissions ?? row.col_3;
          const n = parseInt(adm, 10) || 0;
          if (y) {
            const yStr = String(y).slice(0, 4);
            if (!year || yStr === year) {
              yearTrend[yStr] = (yearTrend[yStr] || 0) + n;
              institutionAdmissions[instName] = (institutionAdmissions[instName] || 0) + n;
              if (course) courseCount[course] = (courseCount[course] || 0) + n;
            }
          }
        });
      }
    });

    res.json({
      success: true,
      data: {
        yearWiseAdmissions: Object.entries(yearTrend).map(([y, count]) => ({ year: y, admissions: count })),
        institutionWise: Object.entries(institutionCount).map(([name, count]) => ({ name, count })),
        institutionAdmissions: Object.entries(institutionAdmissions).map(([name, admissions]) => ({ name, admissions })),
        coursePopularity: Object.entries(courseCount)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([name, count]) => ({ name, count })),
        categoryDistribution: Object.entries(categoryCount).map(([name, count]) => ({ name, count })),
      },
    });
  })
);

// GET /api/historical-files/:id
router.get(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const record = await prisma.historicalFile.findUnique({
      where: { id: req.params.id },
      include: {
        institution: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, username: true } },
      },
    });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    res.json({ success: true, data: record });
  })
);

// DELETE /api/historical-files/:id
router.delete(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const record = await prisma.historicalFile.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    if (record.status === 'LOCKED') {
      return res.status(403).json({ success: false, message: 'Locked files cannot be deleted' });
    }
    const fullPath = path.join(__dirname, '..', record.fileUrl.replace(/^\//, ''));
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    await prisma.historicalFile.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Deleted' });
  })
);

// PUT /api/historical-files/verify/:id
router.put(
  '/verify/:id',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const record = await prisma.historicalFile.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    if (record.status === 'LOCKED') {
      return res.status(403).json({ success: false, message: 'Locked file cannot be modified' });
    }
    const updated = await prisma.historicalFile.update({
      where: { id: req.params.id },
      data: { status: 'VERIFIED', verifiedById: req.userId, verifiedAt: new Date() },
      include: { institution: { select: { name: true } }, uploadedBy: { select: { username: true } } },
    });
    res.json({ success: true, data: updated });
  })
);

// PUT /api/historical-files/lock/:id
router.put(
  '/lock/:id',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const record = await prisma.historicalFile.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    const updated = await prisma.historicalFile.update({
      where: { id: req.params.id },
      data: { status: 'LOCKED' },
      include: { institution: { select: { name: true } }, uploadedBy: { select: { username: true } } },
    });
    res.json({ success: true, data: updated });
  })
);

export default router;
