import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/training/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|mp4|avi|mov|wmv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, documents, and videos are allowed.'));
    }
  }
});

const router = express.Router();

// @route   GET /api/training
// @desc    Get all training content (paginated)
// @access  Private (Counselor or Admin)
router.get('/', authenticate, [
  query('type').optional().isIn(['VIDEO', 'DOCUMENT', 'LINK']),
  query('isActive').optional().isIn(['true', 'false']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const { type, isActive, search } = req.query;
  const where = {};

  if (type) where.type = type;
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } }
    ];
  }

  const [trainingContent, total] = await Promise.all([
    prisma.trainingContent.findMany({
      where,
      include: {
        uploadedBy: {
          select: {
            username: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.trainingContent.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      trainingContent,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    }
  });
}));

// @route   GET /api/training/:id
// @desc    Get single training content
// @access  Private
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const training = await prisma.trainingContent.findUnique({
    where: { id: req.params.id },
    include: {
      uploadedBy: {
        select: {
          username: true,
          email: true
        }
      }
    }
  });

  if (!training) {
    return res.status(404).json({
      success: false,
      message: 'Training content not found'
    });
  }

  // Increment view count
  const updatedTraining = await prisma.trainingContent.update({
    where: { id: req.params.id },
    data: {
      viewCount: {
        increment: 1
      }
    },
    include: {
      uploadedBy: {
        select: {
          username: true,
          email: true
        }
      }
    }
  });

  res.json({
    success: true,
    data: { training: updatedTraining }
  });
}));

// @route   POST /api/training
// @desc    Create training content (Admin only)
// @access  Private (Admin)
router.post('/', authenticate, authorize('ADMIN'), upload.single('file'), [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('type').isIn(['VIDEO', 'DOCUMENT', 'LINK']).withMessage('Type is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { title, description, type, fileUrl } = req.body;

  const trainingData = {
    title,
    description,
    type,
    uploadedById: req.userId
  };

  if (type === 'LINK') {
    trainingData.fileUrl = fileUrl;
  } else if (req.file) {
    trainingData.fileUrl = `/uploads/training/${req.file.filename}`;
    trainingData.fileName = req.file.originalname;
    trainingData.fileSize = req.file.size;
    trainingData.mimeType = req.file.mimetype;
  } else {
    return res.status(400).json({
      success: false,
      message: 'File is required for VIDEO and DOCUMENT types'
    });
  }

  const training = await prisma.trainingContent.create({
    data: trainingData,
    include: {
      uploadedBy: {
        select: {
          username: true,
          email: true
        }
      }
    }
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'CREATE_TRAINING',
      entityType: 'TRAINING',
      entityId: training.id,
      details: { title, type }
    }
  });

  res.status(201).json({
    success: true,
    message: 'Training content created successfully',
    data: { training }
  });
}));

// @route   PUT /api/training/:id
// @desc    Update training content (Admin only)
// @access  Private (Admin)
router.put('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const training = await prisma.trainingContent.findUnique({
    where: { id: req.params.id }
  });
  
  if (!training) {
    return res.status(404).json({
      success: false,
      message: 'Training content not found'
    });
  }

  const allowedFields = ['title', 'description', 'isActive'];
  const updateData = {};
  Object.keys(req.body).forEach(key => {
    if (allowedFields.includes(key)) {
      updateData[key] = req.body[key];
    }
  });

  const updatedTraining = await prisma.trainingContent.update({
    where: { id: req.params.id },
    data: updateData
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'UPDATE_TRAINING',
      entityType: 'TRAINING',
      entityId: training.id,
      details: req.body
    }
  });

  res.json({
    success: true,
    message: 'Training content updated successfully',
    data: { training: updatedTraining }
  });
}));

// @route   DELETE /api/training/:id
// @desc    Delete training content (Admin only)
// @access  Private (Admin)
router.delete('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const training = await prisma.trainingContent.findUnique({
    where: { id: req.params.id }
  });
  
  if (!training) {
    return res.status(404).json({
      success: false,
      message: 'Training content not found'
    });
  }

  await prisma.trainingContent.delete({
    where: { id: req.params.id }
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'DELETE_TRAINING',
      entityType: 'TRAINING',
      entityId: training.id
    }
  });

  res.json({
    success: true,
    message: 'Training content deleted successfully'
  });
}));

export default router;
