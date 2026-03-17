import express from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const router = express.Router();

async function resolveInstitutionIdForUser(req) {
  const explicit = req.user?.institutionId;
  if (explicit) return explicit;
  const inst = await prisma.institution.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return inst?.id || null;
}

async function ensureClassesTable() {
  // Uses raw SQL so this works even if Prisma schema doesn't have a Class model.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "classes" (
      "id" TEXT PRIMARY KEY,
      "institutionId" TEXT NOT NULL,
      "className" TEXT NOT NULL,
      "board" TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "classes_institutionId_idx" ON "classes" ("institutionId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "classes_createdAt_idx" ON "classes" ("createdAt");
  `);
}

// @route   GET /api/classes
// @desc    List classes for logged-in institution
// @access  Private (Admin)
router.get(
  '/',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    await ensureClassesTable();
    const institutionId = await resolveInstitutionIdForUser(req);
    if (!institutionId) {
      return res.status(404).json({ success: false, message: 'Institution not found.' });
    }
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id","institutionId","className","board","createdAt"
       FROM "classes"
       WHERE "institutionId" = $1
       ORDER BY "createdAt" DESC`,
      institutionId,
    );
    res.json({ success: true, data: { classes: rows || [] } });
  }),
);

// @route   POST /api/classes
// @desc    Create a class for logged-in institution
// @access  Private (Admin)
router.post(
  '/',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    await ensureClassesTable();
    const institutionId = await resolveInstitutionIdForUser(req);
    if (!institutionId) {
      return res.status(404).json({ success: false, message: 'Institution not found.' });
    }
    const className = String(req.body.className || '').trim();
    const board = String(req.body.board || '').trim();
    if (!className) {
      return res.status(400).json({ success: false, message: 'Class Name is required.' });
    }
    if (!board) {
      return res.status(400).json({ success: false, message: 'Board is required.' });
    }
    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "classes" ("id","institutionId","className","board")
       VALUES ($1,$2,$3,$4)`,
      id,
      institutionId,
      className,
      board,
    );
    const created = await prisma.$queryRawUnsafe(
      `SELECT "id","institutionId","className","board","createdAt"
       FROM "classes" WHERE "id" = $1 LIMIT 1`,
      id,
    );
    res.status(201).json({ success: true, message: 'Class created', data: { class: created?.[0] } });
  }),
);

// @route   PUT /api/classes/:id
// @desc    Update class for logged-in institution
// @access  Private (Admin)
router.put(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    await ensureClassesTable();
    const institutionId = await resolveInstitutionIdForUser(req);
    if (!institutionId) {
      return res.status(404).json({ success: false, message: 'Institution not found.' });
    }
    const id = String(req.params.id || '').trim();
    const className = req.body.className !== undefined ? String(req.body.className || '').trim() : undefined;
    const board = req.body.board !== undefined ? String(req.body.board || '').trim() : undefined;
    if (className !== undefined && !className) {
      return res.status(400).json({ success: false, message: 'Class Name is required.' });
    }
    if (board !== undefined && !board) {
      return res.status(400).json({ success: false, message: 'Board is required.' });
    }

    const existing = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "classes" WHERE "id" = $1 AND "institutionId" = $2 LIMIT 1`,
      id,
      institutionId,
    );
    if (!existing?.length) {
      return res.status(404).json({ success: false, message: 'Class not found.' });
    }

    if (className === undefined && board === undefined) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "classes"
       SET "className" = COALESCE($3, "className"),
           "board" = COALESCE($4, "board")
       WHERE "id" = $1 AND "institutionId" = $2`,
      id,
      institutionId,
      className ?? null,
      board ?? null,
    );

    const updated = await prisma.$queryRawUnsafe(
      `SELECT "id","institutionId","className","board","createdAt"
       FROM "classes" WHERE "id" = $1 LIMIT 1`,
      id,
    );
    res.json({ success: true, message: 'Class updated', data: { class: updated?.[0] } });
  }),
);

// @route   DELETE /api/classes/:id
// @desc    Delete class for logged-in institution
// @access  Private (Admin)
router.delete(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    await ensureClassesTable();
    const institutionId = await resolveInstitutionIdForUser(req);
    if (!institutionId) {
      return res.status(404).json({ success: false, message: 'Institution not found.' });
    }
    const id = String(req.params.id || '').trim();
    await prisma.$executeRawUnsafe(
      `DELETE FROM "classes" WHERE "id" = $1 AND "institutionId" = $2`,
      id,
      institutionId,
    );
    res.json({ success: true, message: 'Class deleted' });
  }),
);

export default router;

