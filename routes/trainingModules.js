import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';
import upload from '../middleware/upload.js';

const router = express.Router();

// @route   POST /api/training-modules
// @desc    Create training module (Admin only)
// @access  Private (Admin)
router.post('/', authenticate, authorize('ADMIN'), upload.single('file'), [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('contentType')
    .optional()
    .isIn(['VIDEO', 'PDF', 'DOCUMENT', 'EXCEL', 'PPT', 'LINK'])
    .withMessage('Invalid content type'),
  body('counselorIds')
    .optional()
    .custom((value) => {
      if (Array.isArray(value)) return true;
      try {
        const p = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(p);
      } catch { return false; }
    })
    .withMessage('counselorIds must be an array'),
  body('duration')
    .optional({ checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage('Duration must be a positive number'),
  // Allow tags as either an array or a JSON-encoded array string
  body('tags')
    .optional()
    .custom((value) => {
      if (Array.isArray(value)) return true;
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed);
      } catch {
        return false;
      }
    })
    .withMessage('Tags must be an array or JSON array string')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const {
    title,
    description,
    contentType,
    contentUrl,
    fileUrl: bodyFileUrl,
    videoUrl,
    documentUrl,
    linkUrl,
    duration,
    tags,
    schoolId,
    counselorIds,
    isPublished
  } = req.body;

  let counselorIdList = [];
  try {
    counselorIdList = counselorIds ? (Array.isArray(counselorIds) ? counselorIds : JSON.parse(counselorIds || '[]')) : [];
  } catch (_) {}

  const moduleData = {
    title,
    description: description || null,
    contentType: contentType || null,
    duration: duration ? parseInt(duration) : null,
    tags: tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : [],
    schoolId: schoolId || null,
    isPublished: isPublished === 'true' || isPublished === true,
    createdById: req.userId
  };

  if (contentType) {
    if (contentType === 'LINK') {
      const url = contentUrl || linkUrl;
      if (!url) return res.status(400).json({ success: false, message: 'contentUrl is required for LINK type' });
      moduleData.contentUrl = url;
      moduleData.linkUrl = url;
    } else if (req.file) {
      // File stored on disk at /media/training/; only path saved in DB (no BLOB)
      const filePath = '/media/training/' + req.file.filename;
      moduleData.contentUrl = filePath;
      moduleData.fileUrl = filePath;
      if (req.file.size != null && req.file.size > 0) moduleData.fileSize = req.file.size;
      if (contentType === 'VIDEO') moduleData.videoUrl = filePath;
      else if (['DOCUMENT', 'PDF', 'EXCEL', 'PPT'].includes(contentType)) moduleData.documentUrl = filePath;
    } else if (bodyFileUrl) {
      moduleData.fileUrl = bodyFileUrl;
      moduleData.contentUrl = bodyFileUrl;
      if (contentType === 'VIDEO') moduleData.videoUrl = bodyFileUrl;
      else if (['DOCUMENT', 'PDF', 'EXCEL', 'PPT'].includes(contentType)) moduleData.documentUrl = bodyFileUrl;
    } else if (contentType === 'VIDEO' && contentUrl) {
      moduleData.fileUrl = contentUrl;
      moduleData.contentUrl = contentUrl;
      moduleData.videoUrl = contentUrl;
    } else if (!['LINK'].includes(contentType)) {
      return res.status(400).json({ success: false, message: `File or fileUrl required for ${contentType}` });
    }
  } else {
    if (videoUrl) { moduleData.videoUrl = videoUrl; moduleData.contentType = 'VIDEO'; }
    else if (documentUrl) { moduleData.documentUrl = documentUrl; moduleData.contentType = 'DOCUMENT'; }
    else if (linkUrl) { moduleData.contentUrl = linkUrl; moduleData.linkUrl = linkUrl; moduleData.contentType = 'LINK'; }
  }

  let module;
  try {
    module = await prisma.trainingModule.create({
      data: moduleData
    });
  } catch (createErr) {
    // If create fails (e.g. DB missing fileSize column), retry without fileSize
    if (moduleData.fileSize != null && (createErr.code === 'P2010' || createErr.meta?.column || String(createErr.message || '').includes('fileSize'))) {
      const { fileSize: _fs, ...dataWithoutFileSize } = moduleData;
      module = await prisma.trainingModule.create({
        data: dataWithoutFileSize
      });
    } else {
      throw createErr;
    }
  }

  if (counselorIdList.length > 0) {
    await prisma.trainingModuleAssignment.createMany({
      data: counselorIdList.map((counselorId) => ({ moduleId: module.id, counselorId }))
    });
  }

  const moduleWithRelations = await prisma.trainingModule.findUnique({
    where: { id: module.id },
    include: {
      createdBy: { select: { username: true, email: true } },
      school: { select: { id: true, name: true } },
      _count: { select: { assignments: true } }
    }
  });

  // Log activity (EntityType enum has TRAINING, not TRAINING_MODULE)
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'CREATE_TRAINING_MODULE',
      entityType: 'TRAINING',
      entityId: module.id,
      details: { title, contentType: module.contentType || contentType }
    }
  });

  res.status(201).json({
    success: true,
    message: 'Training module created successfully',
    data: moduleWithRelations || module
  });
}));

// @route   GET /api/training-modules
// @desc    Get training modules — Admin: all + assigned count; Counselor: only assigned
// @access  Private
router.get('/', authenticate, [
  query('schoolId').optional(),
  query('isPublished').optional().isBoolean(),
  query('contentType').optional().isIn(['VIDEO', 'PDF', 'DOCUMENT', 'EXCEL', 'PPT', 'LINK']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().trim()
], asyncHandler(async (req, res) => {
  const { schoolId, isPublished, contentType, page = 1, limit = 20, search } = req.query;
  const where = {};

  if (req.user.role === 'COUNSELOR') {
    where.isPublished = true;
    if (req.user.counselorProfile?.id) {
      where.assignments = { some: { counselorId: req.user.counselorProfile.id } };
    }
  } else {
    if (isPublished !== undefined) where.isPublished = isPublished === 'true';
  }

  if (schoolId) where.schoolId = schoolId;
  if (contentType) where.contentType = contentType;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } }
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [modules, total] = await Promise.all([
    prisma.trainingModule.findMany({
      where,
      include: {
        createdBy: { select: { username: true, email: true } },
        school: { select: { id: true, name: true } },
        _count: {
          select: { progress: true, assignments: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit)
    }),
    prisma.trainingModule.count({ where })
  ]);

  if (req.user.role === 'COUNSELOR' && req.user.counselorProfile) {
    const counselorId = req.user.counselorProfile.id;
    const progress = await prisma.trainingProgress.findMany({
      where: { counselorId, moduleId: { in: modules.map(m => m.id) } }
    });
    const progressMap = new Map(progress.map(p => [p.moduleId, p]));
    modules.forEach(m => { m.userProgress = progressMap.get(m.id) || null; });
  }

  res.json({
    success: true,
    data: {
      modules,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

// @route   GET /api/training-modules/:id
// @desc    Get single training module; counselors must be assigned
// @access  Private
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const module = await prisma.trainingModule.findUnique({
    where: { id: req.params.id },
    include: {
      createdBy: { select: { username: true, email: true } },
      school: { select: { id: true, name: true } },
      _count: { select: { assignments: true } },
      assignments: { select: { counselorId: true } }
    }
  });

  if (!module) {
    return res.status(404).json({ success: false, message: 'Training module not found' });
  }

  if (req.user.role === 'COUNSELOR') {
    if (!module.isPublished) {
      return res.status(403).json({ success: false, message: 'This module is not published' });
    }
    if (req.user.counselorProfile?.id) {
      const assigned = await prisma.trainingModuleAssignment.findUnique({
        where: {
          moduleId_counselorId: {
            moduleId: req.params.id,
            counselorId: req.user.counselorProfile.id
          }
        }
      });
      if (!assigned) {
        return res.status(403).json({ success: false, message: 'This module is not assigned to you' });
      }
      await prisma.trainingModule.update({
        where: { id: req.params.id },
        data: { viewsCount: { increment: 1 } }
      });
    }
  }

  if (req.user.role === 'COUNSELOR' && req.user.counselorProfile) {
    const progress = await prisma.trainingProgress.findUnique({
      where: {
        moduleId_counselorId: {
          moduleId: req.params.id,
          counselorId: req.user.counselorProfile.id
        }
      }
    });
    module.userProgress = progress;
  }

  res.json({ success: true, data: module });
}));

// @route   PUT /api/training-modules/:id
// @desc    Update training module (including counselor assignments)
// @access  Private (Admin)
router.put('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { counselorIds, ...rest } = req.body;
  const updateData = { ...rest };
  if (updateData.duration !== undefined) updateData.duration = parseInt(updateData.duration) || null;
  if (updateData.tags && !Array.isArray(updateData.tags)) {
    try { updateData.tags = JSON.parse(updateData.tags); } catch (_) { updateData.tags = []; }
  }
  if (updateData.isPublished !== undefined) updateData.isPublished = updateData.isPublished === 'true' || updateData.isPublished === true;

  const module = await prisma.trainingModule.update({
    where: { id: req.params.id },
    data: updateData
  });

  if (counselorIds !== undefined) {
    const list = Array.isArray(counselorIds) ? counselorIds : (typeof counselorIds === 'string' ? JSON.parse(counselorIds || '[]') : []);
    await prisma.trainingModuleAssignment.deleteMany({ where: { moduleId: req.params.id } });
    if (list.length > 0) {
      await prisma.trainingModuleAssignment.createMany({
        data: list.map((counselorId) => ({ moduleId: req.params.id, counselorId }))
      });
    }
  }

  const updated = await prisma.trainingModule.findUnique({
    where: { id: req.params.id },
    include: {
      createdBy: { select: { username: true, email: true } },
      school: { select: { id: true, name: true } },
      _count: { select: { assignments: true } }
    }
  });
  res.json({ success: true, data: updated });
}));

// @route   POST /api/training-modules/:id/progress
// @desc    Update training progress (Counselor)
// @access  Private (Counselor)
router.post('/:id/progress', authenticate, authorize('COUNSELOR'), [
  body('status').isIn(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']).withMessage('Valid status is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { status } = req.body;
  const counselorId = req.user.counselorProfile.id;
  const moduleId = req.params.id;

  const progress = await prisma.trainingProgress.upsert({
    where: {
      moduleId_counselorId: {
        moduleId,
        counselorId
      }
    },
    create: {
      moduleId,
      counselorId,
      status,
      startedAt: status !== 'NOT_STARTED' ? new Date() : null,
      completedAt: status === 'COMPLETED' ? new Date() : null
    },
    update: {
      status,
      startedAt: status !== 'NOT_STARTED' ? new Date() : undefined,
      completedAt: status === 'COMPLETED' ? new Date() : undefined
    }
  });

  res.json({
    success: true,
    data: progress
  });
}));

// @route   GET /api/training-modules/:id/progress
// @desc    Get training progress for module
// @access  Private (Admin, Management)
router.get('/:id/progress', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const progress = await prisma.trainingProgress.findMany({
    where: {
      moduleId: req.params.id
    },
    include: {
      counselor: {
        include: {
          user: {
            select: {
              username: true,
              email: true
            }
          }
        }
      }
    },
    orderBy: {
      updatedAt: 'desc'
    }
  });

  res.json({
    success: true,
    data: progress
  });
}));

// @route   DELETE /api/training-modules/:id
// @desc    Delete training module
// @access  Private (Admin)
router.delete('/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  await prisma.trainingModule.delete({
    where: { id: req.params.id }
  });

  res.json({
    success: true,
    message: 'Training module deleted successfully'
  });
}));

export default router;
