import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';
import { sendMail } from '../utils/email.js';

const router = express.Router();

// @route   GET /api/sessions
// @desc    Get all sessions (paginated). Supports status, mode, date filter.
// @access  Private
router.get('/', authenticate, [
  query('status').optional().isIn(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED', 'NOT_CONNECTED', 'NO_SHOW_PARENT', 'NO_SHOW_COUNSELOR']),
  query('mode').optional().isIn(['Online', 'Offline']),
  query('counselor').optional(),
  query('lead').optional(),
  query('date').optional().isString(),
  query('startDate').optional().isString(),
  query('endDate').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 200 })
], asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const { status, mode, counselor, lead, date: dateFilter, startDate, endDate } = req.query;
  
  const where = {};

  if (status) where.status = status;
  if (mode) where.mode = mode;
  if (counselor) where.counselorId = counselor;
  if (lead) where.leadId = lead;
  // Prefer startDate/endDate (local timezone boundaries from frontend) over date (UTC)
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      where.scheduledDate = { gte: start, lte: end };
    }
  } else if (dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
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

  const selectWithMeetingLink = {
    id: true,
    leadId: true,
    counselorId: true,
    scheduledDate: true,
    endDate: true,
    duration: true,
    mode: true,
    meetingType: true,
    status: true,
    remarks: true,
    followUpRequired: true,
    followUpDate: true,
    meetingLink: true,
    completedAt: true,
    attemptCount: true,
    lastAttemptAt: true,
    maxAttempts: true,
    connectionReason: true,
    missedCallReasonType: true,
    isOverdue: true,
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
        feedbackStatus: true,
        counselingCompletedAt: true,
        feedbackSentAt: true,
        feedbackSubmittedAt: true,
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
  };

  let sessions;
  let total;
  try {
    const result = await Promise.all([
      prisma.counselingSession.findMany({
        where,
        skip,
        take: limit,
        select: selectWithMeetingLink,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.counselingSession.count({ where })
    ]);
    sessions = result[0];
    total = result[1];
  } catch (err) {
    console.warn('[GET /sessions] First query failed, retrying without meetingLink:', err.message);
    const { meetingLink: _omit, ...selectWithoutMeetingLink } = selectWithMeetingLink;
    try {
      const result = await Promise.all([
        prisma.counselingSession.findMany({
          where,
          skip,
          take: limit,
          select: selectWithoutMeetingLink,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.counselingSession.count({ where })
      ]);
      sessions = result[0].map((s) => ({ ...s, meetingLink: null }));
      total = result[1];
    } catch (retryErr) {
      console.error('[GET /sessions] Retry failed:', retryErr.message);
      throw retryErr;
    }
  }

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
          feedbackStatus: s.lead.feedbackStatus,
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

// @route   GET /api/sessions/counts
// @desc    Dashboard counts: retry, overdue (unique leads), completed (counselor-scoped).
//          Overdue = (1) sessions isOverdue or attempts exhausted, or (2) session ended 1+ hr ago and lead not updated within 1 hr.
// @access  Private
router.get('/counts', authenticate, asyncHandler(async (req, res) => {
  let counselorId = null;
  if (req.user.role === 'COUNSELOR') {
    const cp = await prisma.counselorProfile.findFirst({
      where: { userId: req.userId },
      select: { id: true }
    });
    if (!cp) return res.json({ success: true, data: { retryCount: 0, overdueCount: 0, completedCount: 0 } });
    counselorId = cp.id;
  }

  const [retryResult, overdueByRule1, overdueByRule2, completedCount] = await Promise.all([
    counselorId
      ? prisma.$queryRaw`SELECT COUNT(*)::int as c FROM "counseling_sessions" WHERE "counselorId" = ${counselorId} AND status = 'NOT_CONNECTED' AND "attemptCount" < "maxAttempts"`
      : prisma.$queryRaw`SELECT COUNT(*)::int as c FROM "counseling_sessions" WHERE status = 'NOT_CONNECTED' AND "attemptCount" < "maxAttempts"`,
    counselorId
      ? prisma.$queryRaw`SELECT DISTINCT cs."leadId" FROM "counseling_sessions" cs WHERE cs."counselorId" = ${counselorId} AND cs.status != 'COMPLETED' AND (cs."isOverdue" = true OR cs."attemptCount" >= cs."maxAttempts")`
      : prisma.$queryRaw`SELECT DISTINCT cs."leadId" FROM "counseling_sessions" cs WHERE cs.status != 'COMPLETED' AND (cs."isOverdue" = true OR cs."attemptCount" >= cs."maxAttempts")`,
    counselorId
      ? prisma.$queryRaw`
          SELECT DISTINCT cs."leadId" FROM "counseling_sessions" cs
          INNER JOIN "leads" l ON l.id = cs."leadId"
          WHERE cs."counselorId" = ${counselorId}
            AND cs.status != 'COMPLETED'
            AND (cs."scheduledDate" + interval '1 hour') < now()
            AND l."updatedAt" < (cs."scheduledDate" + interval '1 hour')
        `
      : prisma.$queryRaw`
          SELECT DISTINCT cs."leadId" FROM "counseling_sessions" cs
          INNER JOIN "leads" l ON l.id = cs."leadId"
          WHERE cs.status != 'COMPLETED'
            AND (cs."scheduledDate" + interval '1 hour') < now()
            AND l."updatedAt" < (cs."scheduledDate" + interval '1 hour')
        `,
    prisma.counselingSession.count({
      where: { ...(counselorId && { counselorId }), status: 'COMPLETED' }
    })
  ]);

  const retryCount = Array.isArray(retryResult) && retryResult[0] ? Number(retryResult[0].c) : 0;
  const leadIds1 = (Array.isArray(overdueByRule1) ? overdueByRule1 : []).map((r) => r.leadId).filter(Boolean);
  const leadIds2 = (Array.isArray(overdueByRule2) ? overdueByRule2 : []).map((r) => r.leadId).filter(Boolean);
  const overdueLeadIds = [...new Set([...leadIds1, ...leadIds2])];
  const overdueCount = overdueLeadIds.length;

  res.json({
    success: true,
    data: { retryCount, overdueCount, completedCount }
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

// @route   DELETE /api/sessions/:id
// @desc    Delete a session (counselor: own only; admin: any)
// @access  Private
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const session = await prisma.counselingSession.findUnique({
    where: { id: req.params.id },
    select: { id: true, counselorId: true }
  });

  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Session not found'
    });
  }

  if (req.user.role === 'COUNSELOR') {
    const counselorProfile = await prisma.counselorProfile.findFirst({
      where: { userId: req.userId },
      select: { id: true }
    });
    if (!counselorProfile || session.counselorId !== counselorProfile.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
  }

  await prisma.counselingSession.delete({
    where: { id: req.params.id }
  });

  res.json({
    success: true,
    message: 'Session deleted'
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

  const { lead: leadId, scheduledDate, endDate: bodyEndDate, mode, meetingType: bodyMeetingType, remarks, meetingLink: bodyMeetingLink } = req.body;

  const newStart = new Date(scheduledDate);
  const newEnd = bodyEndDate ? new Date(bodyEndDate) : new Date(newStart.getTime() + 30 * 60 * 1000);
  if (newEnd <= newStart) {
    return res.status(400).json({
      success: false,
      message: 'End time must be after start time'
    });
  }
  const durationMinutes = Math.round((newEnd - newStart) / (60 * 1000));

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

  // Get counselor (with staticMeetLink for Online sessions)
  let counselorId = lead.assignedCounselorId;
  let counselorProfile = null;
  if (req.user.role === 'COUNSELOR') {
    counselorProfile = await prisma.counselorProfile.findFirst({
      where: { userId: req.userId },
      select: { id: true, fullName: true, staticMeetLink: true }
    });
    if (!counselorProfile) {
      return res.status(403).json({
        success: false,
        message: 'Counselor profile not found'
      });
    }
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
  } else {
    counselorProfile = await prisma.counselorProfile.findUnique({
      where: { id: counselorId },
      select: { staticMeetLink: true }
    });
  }

  const meetingLinkToSave = (bodyMeetingLink && String(bodyMeetingLink).trim()) || (counselorProfile?.staticMeetLink && String(counselorProfile.staticMeetLink).trim()) || null;

  // Overlap check: existing.start_time < new_end_time AND existing.end_time > new_start_time (before creating Google event)
  const existingSessions = await prisma.counselingSession.findMany({
    where: { counselorId, status: { not: 'CANCELLED' } },
    select: { id: true, scheduledDate: true, endDate: true }
  });
  const hasOverlap = existingSessions.some((s) => {
    const sStart = new Date(s.scheduledDate);
    const sEnd = s.endDate ? new Date(s.endDate) : new Date(sStart.getTime() + 30 * 60 * 1000);
    return sStart < newEnd && sEnd > newStart;
  });
  if (hasOverlap) {
    return res.status(400).json({
      success: false,
      message: 'Time slot unavailable. Another session already exists during this time.'
    });
  }

  const createData = {
    leadId,
    counselorId,
    scheduledDate: newStart,
    endDate: newEnd,
    duration: durationMinutes,
    mode: mode.toUpperCase() === 'ONLINE' ? 'Online' : 'Offline',
    remarks
  };
  if (meetingLinkToSave) createData.meetingLink = meetingLinkToSave;
  if (createData.mode === 'Online' && bodyMeetingType && ['AUDIO', 'VIDEO'].includes(String(bodyMeetingType).toUpperCase())) {
    createData.meetingType = String(bodyMeetingType).toUpperCase();
  }

  let session;
  try {
    session = await prisma.counselingSession.create({
      data: createData,
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
  } catch (createErr) {
    if (createErr.message && (createErr.message.includes('meetingLink') || createErr.message.includes('meeting_link') || createErr.message.includes('Unknown column'))) {
      delete createData.meetingLink;
      session = await prisma.counselingSession.create({
        data: createData,
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
    } else {
      throw createErr;
    }
  }

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

  // Auto-send meeting link to parent (email)
  if (meetingLinkToSave && lead.parentEmail) {
    const scheduledAt = new Date(scheduledDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const emailBody = `Your counseling session is scheduled for ${scheduledAt}.\n\nJoin using this link:\n${meetingLinkToSave}`;
    sendMail({
      to: lead.parentEmail,
      subject: 'Pravidya – Your counseling session is scheduled',
      text: emailBody,
      html: emailBody.replace(/\n/g, '<br>')
    }).catch((err) => console.warn('[Session] Failed to send meeting link email:', err.message));
  }

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
  if (req.body.connectionReason !== undefined) updateData.connectionReason = req.body.connectionReason;
  if (req.body.missedCallReasonType !== undefined) {
    const v = req.body.missedCallReasonType;
    if (v === null || v === '' || ['COUNSELOR_MISSED', 'PARENT_MISSED', 'CUSTOM'].includes(String(v))) {
      updateData.missedCallReasonType = v === null || v === '' ? null : String(v);
    }
  }

  // When counselor marks session as COMPLETED, set completedAt and lead.counselingCompletedAt
  if (req.body.status === 'COMPLETED' && session.status !== 'COMPLETED') {
    updateData.completedAt = new Date();
    const lead = await prisma.lead.findUnique({ where: { id: session.leadId } });
    if (lead && !lead.counselingCompletedAt) {
      const crypto = await import('crypto');
      const token = lead.feedbackToken || crypto.randomBytes(24).toString('hex');
      await prisma.lead.update({
        where: { id: session.leadId },
        data: {
          counselingCompletedAt: new Date(),
          feedbackStatus: 'NOT_SENT',
          feedbackToken: lead.feedbackToken || token,
        },
      });
    }
  }

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

// @route   POST /api/sessions/:id/reschedule
// @desc    Reschedule session: new scheduledAt, endDate, reset attempt_count, status=RESCHEDULED, optionally new Meet link
// @access  Private
router.post('/:id/reschedule', authenticate, [
  body('scheduledDate').isISO8601().withMessage('Valid scheduled date is required'),
  body('endDate').optional().isISO8601(),
  body('meetingLink').optional().isString()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const session = await prisma.counselingSession.findUnique({
    where: { id: req.params.id },
    include: { counselor: { select: { staticMeetLink: true } } }
  });

  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }

  if (req.user.role === 'COUNSELOR') {
    const counselorProfile = await prisma.counselorProfile.findFirst({
      where: { userId: req.userId }
    });
    if (!counselorProfile || session.counselorId !== counselorProfile.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
  }

  const newStart = new Date(req.body.scheduledDate);
  const newEnd = req.body.endDate ? new Date(req.body.endDate) : new Date(newStart.getTime() + 30 * 60 * 1000);
  if (newEnd <= newStart) {
    return res.status(400).json({
      success: false,
      message: 'End time must be after start time'
    });
  }
  const durationMinutes = Math.round((newEnd - newStart) / (60 * 1000));

  // Overlap check excluding this session
  const existingSessions = await prisma.counselingSession.findMany({
    where: {
      counselorId: session.counselorId,
      status: { not: 'CANCELLED' },
      id: { not: req.params.id }
    },
    select: { id: true, scheduledDate: true, endDate: true }
  });
  const hasOverlap = existingSessions.some((s) => {
    const sStart = new Date(s.scheduledDate);
    const sEnd = s.endDate ? new Date(s.endDate) : new Date(sStart.getTime() + 30 * 60 * 1000);
    return sStart < newEnd && sEnd > newStart;
  });
  if (hasOverlap) {
    return res.status(400).json({
      success: false,
      message: 'Time slot unavailable. Another session already exists during this time.'
    });
  }

  const meetingLink =
    (req.body.meetingLink && String(req.body.meetingLink).trim()) ||
    session.counselor?.staticMeetLink ||
    session.meetingLink ||
    null;

  const updateData = {
    scheduledDate: newStart,
    endDate: newEnd,
    duration: durationMinutes,
    status: 'RESCHEDULED',
    attemptCount: 0,
    lastAttemptAt: null,
    isOverdue: false,
    ...(meetingLink && { meetingLink })
  };
  if (req.body.meetingType !== undefined) {
    if (session.mode === 'Online' && ['AUDIO', 'VIDEO'].includes(String(req.body.meetingType).toUpperCase())) {
      updateData.meetingType = String(req.body.meetingType).toUpperCase();
    } else if (req.body.meetingType === null || req.body.meetingType === '') {
      updateData.meetingType = null;
    }
  }
  const updatedSession = await prisma.counselingSession.update({
    where: { id: req.params.id },
    data: updateData,
    include: {
      lead: { select: { id: true, leadId: true, studentName: true, parentName: true } },
      counselor: { select: { id: true, fullName: true, mobile: true } }
    }
  });

  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'RESCHEDULE_SESSION',
      entityType: 'SESSION',
      entityId: session.id,
      details: { scheduledDate: req.body.scheduledDate }
    }
  });

  res.json({
    success: true,
    message: 'Session rescheduled successfully',
    data: { session: updatedSession }
  });
}));

// @route   POST /api/sessions/:id/retry
// @desc    Schedule retry when lead did not join. Works for NOT_CONNECTED or SCHEDULED/RESCHEDULED past-due (attempt_count < max_attempts). Reschedules 3hr from now.
// @access  Private
router.post('/:id/retry', authenticate, [
  body('scheduledDate').optional().isISO8601()
], asyncHandler(async (req, res) => {
  const session = await prisma.counselingSession.findUnique({
    where: { id: req.params.id },
    include: {
      counselor: { select: { staticMeetLink: true } },
      lead: { select: { status: true } }
    }
  });

  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }

  if (req.user.role === 'COUNSELOR') {
    const counselorProfile = await prisma.counselorProfile.findFirst({
      where: { userId: req.userId }
    });
    if (!counselorProfile || session.counselorId !== counselorProfile.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
  }

  const attemptCount = session.attemptCount ?? 0;
  const maxAttempts = session.maxAttempts ?? 3;
  const isPastDue = new Date(session.scheduledDate) < new Date();
  const leadStatusCallNotConnected = session.lead?.status === 'CALL_NOT_CONNECTED';
  const canRetryBySession =
    (session.status === 'NOT_CONNECTED' || ((session.status === 'SCHEDULED' || session.status === 'RESCHEDULED') && isPastDue)) &&
    attemptCount < maxAttempts;
  const canRetry = canRetryBySession || leadStatusCallNotConnected;

  if (!canRetry) {
    return res.status(400).json({
      success: false,
      message: 'Retry is only available when lead did not join and attempts remain'
    });
  }

  const scheduledDate = req.body.scheduledDate
    ? new Date(req.body.scheduledDate)
    : new Date(Date.now() + 3 * 60 * 60 * 1000);
  const newAttemptCount = attemptCount + 1;

  const updatedSession = await prisma.counselingSession.update({
    where: { id: req.params.id },
    data: {
      scheduledDate,
      status: 'SCHEDULED',
      attemptCount: newAttemptCount,
      lastAttemptAt: new Date(),
      remarks: [session.remarks, `Retry #${newAttemptCount} scheduled at ${scheduledDate.toISOString()} (3hr gap)`].filter(Boolean).join('\n')
    },
    include: {
      lead: { select: { id: true, leadId: true, studentName: true, parentName: true } },
      counselor: { select: { id: true, fullName: true, mobile: true } }
    }
  });

  await prisma.activityLog.create({
    data: {
      userId: req.userId,
      action: 'RETRY_SESSION',
      entityType: 'SESSION',
      entityId: session.id,
      details: { scheduledDate }
    }
  });

  res.json({
    success: true,
    message: 'Retry scheduled successfully',
    data: { session: updatedSession }
  });
}));

export default router;
