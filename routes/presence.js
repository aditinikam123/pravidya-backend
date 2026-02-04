import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import * as presenceService from '../services/presenceTracking.js';
import { prisma } from '../prisma/client.js';

const router = express.Router();

// @route   POST /api/presence/login
// @desc    Record counselor login
// @access  Private (Counselor)
router.post('/login', authenticate, authorize('COUNSELOR'), asyncHandler(async (req, res) => {
  const counselorId = req.user.counselorProfile.id;
  const presence = await presenceService.recordLogin(counselorId);

  res.json({
    success: true,
    data: presence
  });
}));

// @route   POST /api/presence/activity
// @desc    Update counselor activity
// @access  Private (Counselor)
router.post('/activity', authenticate, authorize('COUNSELOR'), asyncHandler(async (req, res) => {
  const counselorId = req.user.counselorProfile.id;
  const presence = await presenceService.updateActivity(counselorId);

  res.json({
    success: true,
    data: presence
  });
}));

// @route   GET /api/presence/status
// @desc    Get counselor presence status
// @access  Private (Counselor, Admin, Management)
router.get('/status', authenticate, authorize(['COUNSELOR', 'ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  let counselorId;

  if (req.user.role === 'COUNSELOR') {
    counselorId = req.user.counselorProfile.id;
  } else {
    counselorId = req.query.counselorId;
    if (!counselorId) {
      return res.status(400).json({
        success: false,
        message: 'counselorId is required for admin/management users'
      });
    }
  }

  const status = await presenceService.getPresenceStatus(counselorId);

  res.json({
    success: true,
    data: status
  });
}));

// @route   GET /api/presence/active
// @desc    Get all active counselors
// @access  Private (Admin, Management)
router.get('/active', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const activeCounselors = await presenceService.getActiveCounselors();

  res.json({
    success: true,
    data: activeCounselors
  });
}));

// @route   GET /api/presence/attendance
// @desc    Get daily attendance
// @access  Private (Admin, Management)
router.get('/attendance', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const date = req.query.date ? new Date(req.query.date) : new Date();
  const attendance = await presenceService.getDailyAttendance(date);

  res.json({
    success: true,
    data: attendance
  });
}));

// @route   GET /api/presence/absent
// @desc    Get counselors absent for the day
// @access  Private (Admin, Management)
router.get('/absent', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const date = req.query.date ? new Date(req.query.date) : new Date();
  const absentCounselors = await presenceService.getAbsentCounselors(date);

  res.json({
    success: true,
    data: absentCounselors
  });
}));

// @route   POST /api/presence/check-inactivity
// @desc    Check and update inactivity status (can be called periodically)
// @access  Private (Admin, Management)
router.post('/check-inactivity', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const counselorId = req.body.counselorId;
  
  if (!counselorId) {
    return res.status(400).json({
      success: false,
      message: 'counselorId is required'
    });
  }

  const presence = await presenceService.checkInactivity(counselorId);

  res.json({
    success: true,
    data: presence
  });
}));

// @route   POST /api/presence/check-all-inactivity
// @desc    Check inactivity for all counselors (periodic job)
// @access  Private (Admin, Management)
router.post('/check-all-inactivity', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const allPresence = await prisma.counselorPresence.findMany({
    where: {
      status: { in: ['ACTIVE', 'AWAY'] }
    }
  });

  const results = [];
  for (const presence of allPresence) {
    const updated = await presenceService.checkInactivity(presence.counselorId);
    results.push({
      counselorId: presence.counselorId,
      previousStatus: presence.status,
      currentStatus: updated?.status || 'OFFLINE',
      changed: presence.status !== updated?.status
    });
  }

  res.json({
    success: true,
    data: {
      checked: results.length,
      results
    }
  });
}));

// @route   GET /api/presence/inactivity-alerts
// @desc    Get inactivity alerts (counselors inactive > 30 minutes)
// @access  Private (Admin, Management)
router.get('/inactivity-alerts', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

  // Find counselors inactive > 30 minutes
  const inactiveCounselors = await prisma.counselorPresence.findMany({
    where: {
      OR: [
        {
          status: { in: ['ACTIVE', 'AWAY'] },
          lastActivityAt: { lt: thirtyMinutesAgo }
        },
        {
          status: 'OFFLINE',
          lastStatusChange: { gte: new Date(now.getTime() - 60 * 60 * 1000) } // Offline in last hour
        }
      ]
    },
    include: {
      counselor: {
        include: {
          user: {
            select: {
              username: true,
              email: true
            }
          },
          assignedLeads: {
            where: {
              status: { in: ['NEW', 'IN_PROGRESS'] }
            },
            select: {
              id: true,
              studentName: true,
              parentName: true
            }
          }
        }
      }
    }
  });

  // Calculate inactivity minutes and format alerts
  const alerts = inactiveCounselors.map(presence => {
    const lastActivity = new Date(presence.lastActivityAt || presence.lastLoginAt);
    const inactiveMinutes = Math.floor((now - lastActivity) / (1000 * 60));

    return {
      counselorId: presence.counselorId,
      counselorName: presence.counselor.fullName,
      email: presence.counselor.user.email,
      currentStatus: presence.status,
      inactiveMinutes,
      lastActivityAt: presence.lastActivityAt,
      lastLoginAt: presence.lastLoginAt,
      affectedLeads: presence.counselor.assignedLeads.length,
      leads: presence.counselor.assignedLeads,
      requiresReassignment: inactiveMinutes > 30 && presence.counselor.assignedLeads.length > 0
    };
  });

  res.json({
    success: true,
    data: {
      alerts,
      total: alerts.length,
      critical: alerts.filter(a => a.requiresReassignment).length
    }
  });
}));

export default router;
