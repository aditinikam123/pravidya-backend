import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const router = express.Router();

// Test route to verify schools router is working
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Schools router is working',
    timestamp: new Date().toISOString()
  });
});

// @route   POST /api/schools
// @desc    Create/Onboard a new school (Admin only)
// @access  Private (Admin)
router.post('/', 
  authenticate, 
  authorize('ADMIN'), 
  [
    body('name').trim().notEmpty().withMessage('School name is required'),
    body('board').isIn(['CBSE', 'ICSE', 'STATE', 'IGCSE']).withMessage('Valid board is required'),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('state').trim().notEmpty().withMessage('State is required'),
    body('academicYear').trim().notEmpty().withMessage('Academic year is required'),
    body('contactEmail').optional({ checkFalsy: true }).isEmail().withMessage('Valid email is required'),
    body('capacity').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('Capacity must be a positive number')
  ],
  asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const {
    name,
    board,
    city,
    state,
    academicYear,
    contactEmail,
    contactPhone,
    address,
    capacity,
    pockets
  } = req.body;

  // Check if school already exists (use findFirst since name may not be unique)
  const existing = await prisma.school.findFirst({
    where: { 
      name,
      isActive: true 
    }
  });

  if (existing) {
    return res.status(400).json({
      success: false,
      message: 'School with this name already exists'
    });
  }

  const customData = req.body.customData && typeof req.body.customData === 'object' ? req.body.customData : null;

  // Create school with pockets in transaction
  const school = await prisma.$transaction(async (tx) => {
    const newSchool = await tx.school.create({
      data: {
        name,
        board,
        city,
        state,
        academicYear,
        contactEmail,
        contactPhone,
        address,
        capacity,
        customData
      }
    });

    // Create pockets if provided
    if (pockets && Array.isArray(pockets) && pockets.length > 0) {
      await tx.schoolPocket.createMany({
        data: pockets.map(pocket => ({
          schoolId: newSchool.id,
          name: pocket.name,
          description: pocket.description
        }))
      });
    }

    return newSchool;
  });

  const schoolWithPockets = await prisma.school.findUnique({
    where: { id: school.id },
    include: {
      pockets: true
    }
  });

  res.status(201).json({
    success: true,
    message: 'School onboarded successfully',
    data: schoolWithPockets
  });
}));

// @route   GET /api/schools
// @desc    Get all schools
// @access  Private (Admin, Management)
router.get('/', authenticate, authorize(['ADMIN', 'MANAGEMENT']), [
  query('board').optional().isIn(['CBSE', 'ICSE', 'STATE', 'IGCSE']),
  query('city').optional().trim(),
  query('state').optional().trim(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], asyncHandler(async (req, res) => {
  const { board, city, state, page = 1, limit = 20, search } = req.query;
  const where = {};

  if (board) where.board = board;
  if (city) where.city = { contains: city, mode: 'insensitive' };
  if (state) where.state = { contains: state, mode: 'insensitive' };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { city: { contains: search, mode: 'insensitive' } }
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [schools, total] = await Promise.all([
    prisma.school.findMany({
      where,
      include: {
        pockets: true,
        _count: {
          select: {
            counselors: true,
            trainingModules: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit)
    }),
    prisma.school.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      schools,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

// @route   GET /api/schools/:id
// @desc    Get single school
// @access  Private (Admin, Management)
router.get('/:id', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const school = await prisma.school.findUnique({
    where: { id: req.params.id },
    include: {
      pockets: true,
      counselors: {
        include: {
          user: {
            select: {
              username: true,
              email: true,
              isActive: true
            }
          }
        }
      },
      trainingModules: {
        where: { isPublished: true }
      }
    }
  });

  if (!school) {
    return res.status(404).json({
      success: false,
      message: 'School not found'
    });
  }

  res.json({
    success: true,
    data: school
  });
}));

// @route   PUT /api/schools/:id
// @desc    Update school
// @access  Private (Admin)
router.put('/:id', authenticate, authorize('ADMIN'), [
  body('name').optional().trim().notEmpty(),
  body('board').optional().isIn(['CBSE', 'ICSE', 'STATE', 'IGCSE']),
  body('capacity').optional().isInt({ min: 1 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { pockets, customData, ...rest } = req.body;
  const updateData = { ...rest };
  if (customData !== undefined) {
    updateData.customData = customData && typeof customData === 'object' ? customData : null;
  }

  const school = await prisma.$transaction(async (tx) => {
    const updated = await tx.school.update({
      where: { id: req.params.id },
      data: updateData
    });

    // Update pockets if provided
    if (pockets && Array.isArray(pockets)) {
      // Delete existing pockets
      await tx.schoolPocket.deleteMany({
        where: { schoolId: updated.id }
      });

      // Create new pockets
      if (pockets.length > 0) {
        await tx.schoolPocket.createMany({
          data: pockets.map(pocket => ({
            schoolId: updated.id,
            name: pocket.name,
            description: pocket.description
          }))
        });
      }
    }

    return updated;
  });

  const schoolWithPockets = await prisma.school.findUnique({
    where: { id: school.id },
    include: {
      pockets: true
    }
  });

  res.json({
    success: true,
    data: schoolWithPockets
  });
}));

// @route   POST /api/schools/:id/pockets
// @desc    Add pocket to school
// @access  Private (Admin)
router.post('/:id/pockets', authenticate, authorize('ADMIN'), [
  body('name').trim().notEmpty().withMessage('Pocket name is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const pocket = await prisma.schoolPocket.create({
    data: {
      schoolId: req.params.id,
      name: req.body.name,
      description: req.body.description
    }
  });

  res.status(201).json({
    success: true,
    data: pocket
  });
}));

// @route   DELETE /api/schools/:id
// @desc    Delete school (soft delete)
// @access  Private (Admin)
router.delete('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const school = await prisma.school.update({
    where: { id: req.params.id },
    data: { isActive: false }
  });

  res.json({
    success: true,
    message: 'School deactivated successfully',
    data: school
  });
}));

export default router;
