import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { fileURLToPath } from 'url';
import { prisma } from '../prismaClient.js';
import { trainFromSource, queryIntelligence, queryIntelligenceStream } from '../modules/intelligence/services/intelligenceService.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const intelligenceUploadDir = path.join(__dirname, '../uploads/intelligence');

if (!fs.existsSync(intelligenceUploadDir)) {
  fs.mkdirSync(intelligenceUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, intelligenceUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_SIZE || 10 * 1024 * 1024) },
});

// ---------- Helpers ----------

const detectFileType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.txt') return 'txt';
  if (ext === '.csv') return 'csv';
  if (ext === '.docx') return 'docx';
  return 'unknown';
};

const extractTextFromFile = async (filePath) => {
  const type = detectFileType(filePath);
  const buffer = await fs.promises.readFile(filePath);
  if (type === 'pdf') {
    const data = await pdfParse(buffer);
    return data.text || '';
  }
  if (type === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    return value || '';
  }
  if (type === 'csv' || type === 'txt') return buffer.toString('utf8');
  throw new Error(`Unsupported file type: ${type}`);
};

const getOrganizationId = (req) =>
  req.body?.organizationId || req.query?.organizationId || req.user?.academyId || req.user?.id || 'default-org';

/** Normalize extracted text for consistent content hashing (same content → same hash even if whitespace differs). */
function contentHashFromText(text) {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// ---------- Routes ----------

// GET all uploaded sources (admin sees full list; duplicate check uses contentHash across all)
router.get('/sources', async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const limitParam = parseInt(req.query.limit, 10);
    const limit = Number.isNaN(limitParam) ? 200 : Math.min(limitParam, 500);
    const sources = await prisma.knowledgeSource.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        fileName: true,
        fileType: true,
        createdAt: true,
      },
    });
    return res.json({ success: true, data: { sources } });
  } catch (err) {
    console.error('[intelligence/sources]', err);
    return res.status(500).json({ success: false, message: 'Failed to load sources' });
  }
});

// GET view/download a specific source file (admin only; org-scoped)
router.get('/sources/:id/view', async (req, res) => {
  try {
    const organizationId = getOrganizationId(req);
    const source = await prisma.knowledgeSource.findFirst({
      where: { id: req.params.id, organizationId },
      select: { filePath: true, fileName: true, fileType: true },
    });
    if (!source) {
      return res.status(404).json({ success: false, message: 'Source not found' });
    }
    const resolved = path.normalize(path.resolve(source.filePath));
    const dirResolved = path.normalize(path.resolve(intelligenceUploadDir));
    const resolvedLower = resolved.toLowerCase();
    const dirLower = dirResolved.toLowerCase();
    const insideDir = process.platform === 'win32'
      ? resolvedLower.startsWith(dirLower) && (resolvedLower.length === dirLower.length || resolvedLower[dirLower.length] === path.sep)
      : resolved.startsWith(dirResolved + path.sep) || resolved === dirResolved;
    if (!insideDir || !fs.existsSync(resolved)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    const mime = {
      pdf: 'application/pdf',
      txt: 'text/plain',
      csv: 'text/csv',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }[source.fileType] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(source.fileName)}"`);
    return res.sendFile(resolved);
  } catch (err) {
    console.error('[intelligence/sources/view]', err);
    return res.status(500).json({ success: false, message: 'Failed to load file' });
  }
});

// 1) Upload → persist KnowledgeSource in DB; reject if same content already uploaded
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'File is required' });
    }
    const organizationId = getOrganizationId(req);

    let extractedText = '';
    try {
      extractedText = await extractTextFromFile(req.file.path);
    } catch (extractErr) {
      try { await fs.promises.unlink(req.file.path); } catch (_) {}
      return res.status(400).json({
        success: false,
        message: 'Could not read file content. Supported: PDF, CSV, TXT, DOCX.',
      });
    }

    const contentHash = contentHashFromText(extractedText);

    const existing = await prisma.knowledgeSource.findFirst({
      where: { organizationId, contentHash },
    });
    if (existing) {
      try { await fs.promises.unlink(req.file.path); } catch (_) {}
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_CONTENT',
        message: 'This file or content has already been uploaded. Upload a different file or different content.',
      });
    }

    const source = await prisma.knowledgeSource.create({
      data: {
        organizationId,
        fileName: req.file.originalname,
        filePath: req.file.path,
        fileType: detectFileType(req.file.path),
        uploadedBy: req.user?.id || 'system',
        contentHash,
      },
    });
    return res.status(201).json({ success: true, data: source });
  } catch (err) {
    console.error('[intelligence/upload]', err);
    return res.status(500).json({ success: false, message: 'Upload failed' });
  }
});

// 2) Train → extract text, chunk, Gemini embeddings, store in KnowledgeChunk
router.post('/train', async (req, res) => {
  try {
    const { sourceId } = req.body || {};
    if (!sourceId) {
      return res.status(400).json({ success: false, message: 'sourceId is required' });
    }

    const organizationId =
      req.body.organizationId || req.user?.academyId || req.user?.id || 'default-org';
    const source = await prisma.knowledgeSource.findFirst({
      where: { id: sourceId, organizationId },
    });
    if (!source) {
      return res.status(404).json({ success: false, message: 'Knowledge source not found' });
    }

    const text = await extractTextFromFile(source.filePath);
    if (!text.trim()) {
      return res.status(400).json({ success: false, message: 'No text extracted from file' });
    }

    const { chunksCreated } = await trainFromSource({
      sourceId,
      text,
      organizationId,
    });
    return res.json({
      success: true,
      data: { sourceId, chunksCreated },
    });
  } catch (err) {
    console.error('[intelligence/train]', err);
    return res
      .status(500)
      .json({ success: false, message: err.message || 'Training failed' });
  }
});

// 3) Query → QueryCache → Gemini embed → pgvector → Gemini answer → cache
router.post('/query', async (req, res) => {
  try {
    const { query, stream: useStream } = req.body || {};
    if (!query) {
      return res.status(400).json({ success: false, message: 'query is required' });
    }
    const organizationId =
      req.body.organizationId || req.user?.academyId || req.user?.id || 'default-org';

    if (useStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      try {
        for await (const chunk of queryIntelligenceStream({ query: query.trim(), organizationId })) {
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
          res.flush?.();
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      } catch (err) {
        console.error('[intelligence/query-stream]', err);
        res.write(`data: ${JSON.stringify({ error: err.message || 'Query failed' })}\n\n`);
      }
      res.end();
      return;
    }

    const { answer } = await queryIntelligence({ query: query.trim(), organizationId });
    return res.json({
      success: true,
      data: { query: query.trim(), answer },
    });
  } catch (err) {
    console.error('[intelligence/query]', err);
    return res
      .status(500)
      .json({ success: false, message: err.message || 'Query failed' });
  }
});

export default router;

