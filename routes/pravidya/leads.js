import express from 'express';
import { body, validationResult } from 'express-validator';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { prisma } from '../../prismaClient.js';

const router = express.Router();

const normalizeAcademySlug = (s) => {
  const slug = (s || '').toLowerCase().trim();
  return slug === 'veman' ? 'veeman' : slug;
};

const validateCreateLead = [
  body('academySlug').trim().notEmpty().withMessage('Academy slug is required'),
  body('studentName').trim().notEmpty().withMessage('Student name is required'),
  body('parentName').trim().notEmpty().withMessage('Parent name is required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('course').trim().notEmpty().withMessage('Course interested is required'),
];

/**
 * POST /api/pravidya/leads/create
 * Create enquiry lead (public)
 */
router.post(
  '/create',
  validateCreateLead,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      academySlug,
      studentName,
      parentName,
      phone,
      email,
      course,
      source = 'DIRECT',
    } = req.body;

    const academy = await prisma.academy.findUnique({
      where: { slug: normalizeAcademySlug(academySlug) },
    });

    if (!academy) {
      return res.status(404).json({
        success: false,
        message: 'Academy not found',
      });
    }

    const lead = await prisma.academyLead.create({
      data: {
        academyId: academy.id,
        studentName: studentName.trim(),
        parentName: parentName.trim(),
        phone: phone.trim(),
        email: email.toLowerCase(),
        course: course.trim(),
        source: source.trim() || 'DIRECT',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Thank you for your enquiry. We will contact you soon.',
      data: {
        lead: {
          id: lead.id,
          studentName: lead.studentName,
          createdAt: lead.createdAt,
        },
      },
    });
  })
);

export default router;
