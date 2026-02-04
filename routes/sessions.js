import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const router = express.Router();

// @route   GET /api/sessions
// @desc    Get all sessions (paginated). Supports status, mode, date filter.
// @access  Private
router.get('/', authenticate, [
  query('status').optional().isIn(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED']),
  query('mode').optional().isIn(['Online', 'Offline']),
  query('counselor').optional(),
  query('lead').optional(),
  query('date').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 200 })
], asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const { status, mode, counselor, lead, date: dateFilter } = req.query;
  
  const where = {};

  if (status) where.status = status;
  if (mode) where.mode = mode;
  if (counselor) where.counselorId = counselor;
  if (lead) where.leadId = lead;
  if (dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
    const start = new Date(dateFilter + 'T00:00:00.000Z');
    const end = new Date(dateFilter + 'T23:59:59.999Z');
    where.scheduledDate = { gte: start, lte: end };
  }

  // If counselor, only show their sessions
  if (req.user.role === 'COUNSELOR') {
    const counselorProfile = await prisma.counselorProfile.findFirst({
      where: { userId: req.userId }
    });
    if (counselorProfile) {
      where.counselorId = counselorProfile.id;
    } else {
      return res.json({
        success: true,
        data: { sessions: [], total: 0, page: 1, totalPages: 0 }
      });
    }
  }

  const [sessions, total] = await Promise.all([
    prisma.counselingSession.findMany({
      where,
      skip,
      take: limit,
      select: {
        id: true,
        leadId: true,
        counselorId: true,
        scheduledDate: true,
        mode: true,
        status: true,
        remarks: true,
        followUpRequired: true,
        followUpDate: true,
        createdAt: true,
        lead: {
          select: {
            id: true,
            leadId: true,
            studentName: true,
            parentName: true,
            parentMobile: true,
            parentEmail: true,
            currentClass: true,
            status: true,
            institution: { select: { name: true } },
            course: { select: { name: true } }
          }
        },
        counselor: {
          select: {
            id: true,
            fullName: true,
            mobile: true
          }
        }
      },
      orderBy: { scheduledDate: 'desc' }
    }),
    prisma.counselingSession.count({ where })
  ]);

  const sessionsWithLeadStatus = sessions.map((s) => ({
    ...s,
    lead: s.lead
      ? {
          id: s.lead.id,
          leadId: s.lead.leadId,
          studentName: s.lead.studentName,
          parentName: s.lead.parentName,
          parentMobile: s.lead.parentMobile,
          parentEmail: s.lead.parentEmail,
          currentClass: s.lead.currentClass,
          status: s.lead.status,
          institution: s.lead.institution,
          course: s.lead.course,
        }
      : null,
  }));

  res.json({
    success: true,
    data: {
      sessions: sessionsWithLeadStatus,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    }
  });
}));

// @route   GET /api/sessions/:id
// @desc    Get single session
// @access  Private
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const session = await prisma.counselingSession.findUnique({
    where: { id: req.params.id },
    include: {
      lead: true,
      counselor: {
        include: {
          user: {
            select: {
              email: true
            }
          }
        },
        select: {
          id: true,
          fullName: true,
          mobile: true,
          email: true,
          expertise: true,
          languages: true
        }
      }
    }
  });

  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Session not found'
    });
  }

  // Check access
  if (req.user.role === 'COUNSELOR') {
    const counselorProfile = await prisma.counselorProfile.findFirst({
      where: { userId: req.userId }
    });
    if (!counselorProfile || session.counselorId !== counselorProfile.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
  }

  res.json({
    success: true,
    data: { session }
  });
}));

// @route   POST /api/sessions
// @desc    Create session
// @access  Private
router.post('/', authenticate, [
  body('lead').notEmpty().withMessage('Lead ID is required'),
  body('scheduledDate').isISO8601().withMessage('Valid scheduled date is required'),
  body('mode').isIn(['Online', 'Offline']).withMessage('Mode must be Online or Offline')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { lead: leadId, scheduledDate, mode, remarks } = req.body;

  // Verify lead exists
  const lead = await prisma.lead.findUnique({
    where: { id: leadId }
  });
  
  if (!lead) {
    return res.status(404).json({
      success: false,
      message: 'Lead not found'
    });
  }

  // Get counselor
  let counselorId = lead.assignedCounselorId;
  if (req.user.role === 'COUNSELOR') {
    const counselorProfile = await prisma.counselorProfile.findFirst({
      where: { userId: req.userId }
    });
    if (!counselorProfile) {
      return res.status(403).json({
        success: false,
        message: 'Counselor profile not found'
      });
    }
    // Verify counselor is assigned to this lead
    if (lead.assignedCounselorId !== counselorProfile.id) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this lead'
      });
    }
    counselorId = counselorProfile.id;
  } else if (!counselorId) {
    return res.status(400).json({
      success: false,
      message: 'Lead has no assigned counselor'
    });
  }

  const session = await prisma.counselingSession.create({
    data: {
      leadId,
      counselorId,
      scheduledDate: new Date(scheduledDate),
      mode: mode.toUpperCase() === 'ONLINE' ? 'Online' : 'Offline',
      remarks
    },
    include: {
      lead: {
        select: {
          id: true,
          leadId: true,
          studentName: true,
          parentName: true
        }
      },
      counselor: {
        select: {
          id: true,
          fullName: true,
          mobile: true
        }
      }
    }
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'CREATE_SESSION',
      entityType: 'SESSION',
      entityId: session.id,
      details: { leadId, scheduledDate, mode }
    }
  });

  res.status(201).json({
    success: true,
    message: 'Session created successfully',
    data: { session }
  });
}));

// @route   PUT /api/sessions/:id
// @desc    Update session
// @access  Private
router.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const session = await prisma.counselingSession.findUnique({
    where: { id: req.params.id }
  });
  
  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Session not found'
    });
  }

  // Check access
  if (req.user.role === 'COUNSELOR') {
    const counselorProfile = await prisma.counselorProfile.findFirst({
      where: { userId: req.userId }
    });
    if (!counselorProfile || session.counselorId !== counselorProfile.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
  }

  // Prepare update data
  const updateData = {};
  if (req.body.scheduledDate) updateData.scheduledDate = new Date(req.body.scheduledDate);
  if (req.body.mode) updateData.mode = req.body.mode.toUpperCase() === 'ONLINE' ? 'Online' : 'Offline';
  if (req.body.status) updateData.status = req.body.status;
  if (req.body.remarks !== undefined) updateData.remarks = req.body.remarks;
  if (req.body.followUpRequired !== undefined) updateData.followUpRequired = req.body.followUpRequired;
  if ('followUpDate' in req.body) updateData.followUpDate = req.body.followUpDate ? new Date(req.body.followUpDate) : null;

  const updatedSession = await prisma.counselingSession.update({
    where: { id: req.params.id },
    data: updateData,
    include: {
      lead: {
        select: {
          id: true,
          leadId: true,
          studentName: true,
          parentName: true
        }
      },
      counselor: {
        select: {
          id: true,
          fullName: true,
          mobile: true
        }
      }
    }
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'UPDATE_SESSION',
      entityType: 'SESSION',
      entityId: session.id,
      details: req.body
    }
  });

  res.json({
    success: true,
    message: 'Session updated successfully',
    data: { session: updatedSession }
  });
}));

export default router;
