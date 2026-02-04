import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const router = express.Router();

// @route   GET /api/todos
// @desc    Get all todos for current user (paginated)
// @access  Private
router.get('/', authenticate, [
  query('status').optional().isIn(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
  query('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const { status, priority } = req.query;
  const where = { userId: req.userId };

  if (status) where.status = status;
  if (priority) where.priority = priority;

  const [todos, total] = await Promise.all([
    prisma.todo.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        lead: {
          select: {
            id: true,
            studentName: true,
            parentName: true,
            parentMobile: true,
            institution: { select: { name: true } }
          }
        }
      }
    }),
    prisma.todo.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      todos,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    }
  });
}));

// @route   GET /api/todos/:id
// @desc    Get single todo
// @access  Private
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const todo = await prisma.todo.findFirst({
    where: {
      id: req.params.id,
      userId: req.userId
    },
    include: {
      lead: {
        select: {
          id: true,
          studentName: true,
          parentName: true,
          parentMobile: true,
          institution: { select: { name: true } }
        }
      }
    }
  });

  if (!todo) {
    return res.status(404).json({
      success: false,
      message: 'Todo not found'
    });
  }

  res.json({
    success: true,
    data: { todo }
  });
}));

// @route   POST /api/todos
// @desc    Create todo (title required; dueDate optional, parsed)
// @access  Private
router.post('/', authenticate, [
  body('title').trim().notEmpty().withMessage('Title is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const first = errors.array()[0];
    const message = first?.msg || first?.message || 'Validation failed';
    return res.status(400).json({
      success: false,
      message,
      errors: errors.array()
    });
  }

  const title = String(req.body.title || '').trim();
  const description = req.body.description != null ? String(req.body.description).trim() || null : null;
  const priority = ['LOW', 'MEDIUM', 'HIGH'].includes(req.body.priority) ? req.body.priority : 'MEDIUM';
  let dueDate = null;
  if (req.body.dueDate && String(req.body.dueDate).trim()) {
    const d = new Date(req.body.dueDate);
    if (!Number.isNaN(d.getTime())) dueDate = d.toISOString();
  }

  let leadId = null;
  if (req.body.leadId && String(req.body.leadId).trim()) {
    const counselor = await prisma.counselorProfile.findUnique({
      where: { userId: req.userId },
      select: { id: true }
    });
    if (!counselor) {
      return res.status(403).json({
        success: false,
        message: 'Counselor profile not found'
      });
    }
    const lead = await prisma.lead.findFirst({
      where: {
        id: req.body.leadId.trim(),
        assignedCounselorId: counselor.id
      },
      select: { id: true }
    });
    if (!lead) {
      return res.status(400).json({
        success: false,
        message: 'Lead not found or not assigned to you'
      });
    }
    leadId = lead.id;
  }

  const todo = await prisma.todo.create({
    data: {
      userId: req.userId,
      leadId,
      title,
      description,
      priority,
      dueDate,
      status: 'PENDING'
    },
    include: {
      lead: {
        select: {
          id: true,
          studentName: true,
          parentName: true,
          parentMobile: true,
          institution: { select: { name: true } }
        }
      }
    }
  });

  res.status(201).json({
    success: true,
    message: 'Todo created successfully',
    data: { todo }
  });
}));

// @route   PUT /api/todos/:id
// @desc    Update todo
// @access  Private
router.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const todo = await prisma.todo.findFirst({
    where: {
      id: req.params.id,
      userId: req.userId
    }
  });

  if (!todo) {
    return res.status(404).json({
      success: false,
      message: 'Todo not found'
    });
  }

  // Only allow updating these fields (sanitize body)
  const data = {};
  if (req.body.title !== undefined) data.title = String(req.body.title).trim();
  if (req.body.description !== undefined) data.description = req.body.description == null ? null : String(req.body.description).trim() || null;
  if (req.body.priority !== undefined && ['LOW', 'MEDIUM', 'HIGH'].includes(req.body.priority)) data.priority = req.body.priority;
  if (req.body.status !== undefined && ['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(req.body.status)) data.status = req.body.status;

  if (req.body.dueDate !== undefined) {
    if (req.body.dueDate == null || String(req.body.dueDate).trim() === '') {
      data.dueDate = null;
    } else {
      const d = new Date(req.body.dueDate);
      if (!Number.isNaN(d.getTime())) data.dueDate = d.toISOString();
    }
  }

  if (req.body.leadId !== undefined) {
    if (!req.body.leadId || String(req.body.leadId).trim() === '') {
      data.leadId = null;
    } else {
      const counselor = await prisma.counselorProfile.findUnique({
        where: { userId: req.userId },
        select: { id: true }
      });
      const lead = counselor
        ? await prisma.lead.findFirst({
            where: {
              id: String(req.body.leadId).trim(),
              assignedCounselorId: counselor.id
            },
            select: { id: true }
          })
        : null;
      data.leadId = lead ? lead.id : null;
    }
  }

  const updatedTodo = await prisma.todo.update({
    where: { id: req.params.id },
    data,
    include: {
      lead: {
        select: {
          id: true,
          studentName: true,
          parentName: true,
          parentMobile: true,
          institution: { select: { name: true } }
        }
      }
    }
  });

  res.json({
    success: true,
    message: 'Todo updated successfully',
    data: { todo: updatedTodo }
  });
}));

// @route   DELETE /api/todos/:id
// @desc    Delete todo
// @access  Private
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const todo = await prisma.todo.findFirst({
    where: {
      id: req.params.id,
      userId: req.userId
    }
  });

  if (!todo) {
    return res.status(404).json({
      success: false,
      message: 'Todo not found'
    });
  }

  await prisma.todo.delete({
    where: { id: req.params.id }
  });

  res.json({
    success: true,
    message: 'Todo deleted successfully'
  });
}));

export default router;
