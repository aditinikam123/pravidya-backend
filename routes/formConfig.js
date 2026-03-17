import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { getFormFieldSettings } from './admin.js';

const router = express.Router();

// @route   GET /api/form-config
// @desc    Get dynamic form configuration for lead creation (Admin-only)
// @access  Private (Admin)
router.get(
  '/',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const settings = await getFormFieldSettings();
    const config = settings.leadFormConfig || {};
    res.json({
      success: true,
      data: {
        sections: Array.isArray(config.sections) ? config.sections : [],
      },
    });
  }),
);

export default router;

