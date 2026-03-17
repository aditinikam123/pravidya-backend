import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const router = express.Router();

async function resolveInstitutionIdForUser(req) {
  // Main-app users can be scoped to a single institution via users.institutionId
  const explicit = req.user?.institutionId;
  if (explicit) return explicit;

  // Fallback for legacy/global admins: pick the newest institution.
  const inst = await prisma.institution.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return inst?.id || null;
}

// @route   GET /api/institution/me
// @desc    Get the logged-in admin's institution (single-tenant)
// @access  Private (Admin)
router.get(
  '/me',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const institutionId = await resolveInstitutionIdForUser(req);
    if (!institutionId) {
      return res.status(404).json({
        success: false,
        message: 'No institution found for this admin.',
      });
    }

    const institution = await prisma.institution.findUnique({
      where: { id: institutionId },
    });

    if (!institution) {
      return res.status(404).json({
        success: false,
        message: 'Institution not found.',
      });
    }

    res.json({ success: true, data: { institution } });
  }),
);

// @route   PUT /api/institution/me
// @desc    Update the logged-in admin's institution profile/settings
// @access  Private (Admin)
router.put(
  '/me',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const institutionId = await resolveInstitutionIdForUser(req);
    if (!institutionId) {
      return res.status(404).json({
        success: false,
        message: 'No institution found for this admin.',
      });
    }

    const allowed = [
      'name',
      'logoUrl',
      'type',
      'address',
      'city',
      'state',
      'boardsOffered',
      'admissionsOpen',
      'customData',
    ];

    const data = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) data[k] = req.body[k];
    }

    // Hard safety: boardsOffered must be array of strings
    if (data.boardsOffered !== undefined) {
      data.boardsOffered = Array.isArray(data.boardsOffered)
        ? data.boardsOffered.map((b) => String(b).trim()).filter(Boolean)
        : [];
    }

    // Optional: ensure customData is either null or object
    if (data.customData !== undefined) {
      if (data.customData === null) {
        // ok
      } else if (typeof data.customData !== 'object') {
        delete data.customData;
      }
    }

    const institution = await prisma.institution.update({
      where: { id: institutionId },
      data,
    });

    res.json({
      success: true,
      message: 'Institution updated successfully',
      data: { institution },
    });
  }),
);

export default router;

