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

// @route   POST /api/presence/clock-in
// @desc    Counselor clock in – set status ACTIVE, store clock_in time
// @access  Private (Counselor)
router.post('/clock-in', authenticate, authorize('COUNSELOR'), asyncHandler(async (req, res) => {
  const counselorId = req.user.counselorProfile.id;
  const presence = await presenceService.clockIn(counselorId);
  res.json({ success: true, data: presence });
}));

// @route   POST /api/presence/clock-out
// @desc    Counselor clock out – set status OFFLINE, store clock_out time
// @access  Private (Counselor)
router.post('/clock-out', authenticate, authorize('COUNSELOR'), asyncHandler(async (req, res) => {
  const counselorId = req.user.counselorProfile.id;
  const presence = await presenceService.clockOut(counselorId);
  res.json({ success: true, data: presence || {} });
}));

// @route   POST /api/presence/break-start
// @desc    Counselor start break – body: { reason, customReason? }
// @access  Private (Counselor)
router.post('/break-start', authenticate, authorize('COUNSELOR'), asyncHandler(async (req, res) => {
  const counselorId = req.user.counselorProfile?.id ?? req.user.counselorProfile?._id;
  if (!counselorId) {
    return res.status(400).json({ success: false, message: 'Counselor profile not found. Please log in again.' });
  }
  const { reason, customReason } = req.body || {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ success: false, message: 'Break reason is required' });
  }
  const presence = await presenceService.breakStart(counselorId, String(reason).trim(), customReason ? String(customReason).trim() : null);
  if (!presence) {
    return res.status(400).json({ success: false, message: 'Please clock in first, then start a break.' });
  }
  res.json({ success: true, data: presence });
}));

// @route   POST /api/presence/break-end
// @desc    Counselor end break – set status ACTIVE, store break_end time
// @access  Private (Counselor)
router.post('/break-end', authenticate, authorize('COUNSELOR'), asyncHandler(async (req, res) => {
  const counselorId = req.user.counselorProfile.id;
  const presence = await presenceService.breakEnd(counselorId);
  res.json({ success: true, data: presence });
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

// @route   GET /api/presence/all-status
// @desc    Get all counselors with current status (for admin Counselor Status panel)
// @access  Private (Admin, Management)
router.get('/all-status', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const list = await presenceService.getAllCounselorsStatus();
  res.json({ success: true, data: list });
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
// @desc    Get inactivity alerts (counselors inactive >= 4 hours) + show auto-reassignment results (read-only)
// @access  Private (Admin, Management)
router.get('/inactivity-alerts', authenticate, authorize(['ADMIN', 'MANAGEMENT']), asyncHandler(async (req, res) => {
  const now = new Date();
  const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

  // Find counselors inactive >= 4 hours
  const inactiveCounselors = await prisma.counselorPresence.findMany({
    where: {
      status: { in: ['ACTIVE', 'AWAY', 'OFFLINE'] },
      OR: [
        { lastActivityAt: { lt: fourHoursAgo } },
        { lastActivityAt: null, lastLoginAt: { lt: fourHoursAgo } },
        { lastActivityAt: null, lastLoginAt: null, lastStatusChange: { lt: fourHoursAgo } },
      ],
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
              status: { in: ['NEW', 'CONTACTED', 'FOLLOW_UP'] }
            },
            select: {
              id: true,
              studentName: true,
              parentName: true,
              preferredLanguage: true,
              assignedCounselorId: true,
              leadId: true,
            }
          }
        }
      }
    }
  });

  // Pull recent auto-reassignment logs so UI can show "assigned to which counselor"
  const counselorIds = inactiveCounselors.map((p) => p.counselorId).filter(Boolean);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recentReassignRows = counselorIds.length
    ? await prisma.$queryRaw`
        SELECT "entityId", "createdAt", "details"
        FROM "activity_logs"
        WHERE "action" = 'AUTO_REASSIGN_LEAD'
          AND ("details"->>'fromCounselorId') = ANY(${counselorIds}::text[])
          AND "createdAt" >= ${oneDayAgo}
        ORDER BY "createdAt" DESC
        LIMIT 100
      `
    : [];

  const leadIdsFromLogs = Array.isArray(recentReassignRows)
    ? recentReassignRows.map((r) => r?.entityId).filter(Boolean)
    : [];
  const toCounselorIdsFromLogs = Array.isArray(recentReassignRows)
    ? recentReassignRows.map((r) => r?.details?.toCounselorId).filter(Boolean)
    : [];

  const [leadsForLogs, counselorsForLogs] = await Promise.all([
    leadIdsFromLogs.length
      ? prisma.lead.findMany({
          where: { id: { in: leadIdsFromLogs } },
          select: { id: true, leadId: true, studentName: true },
        })
      : Promise.resolve([]),
    toCounselorIdsFromLogs.length
      ? prisma.counselorProfile.findMany({
          where: { id: { in: toCounselorIdsFromLogs } },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
  ]);

  const leadById = new Map(leadsForLogs.map((l) => [l.id, l]));
  const counselorById = new Map(counselorsForLogs.map((c) => [c.id, c]));
  const reassignedByFromCounselor = new Map(); // fromCounselorId -> reassignedLeads[]
  for (const row of Array.isArray(recentReassignRows) ? recentReassignRows : []) {
    const fromCounselorId = row?.details?.fromCounselorId;
    const toCounselorId = row?.details?.toCounselorId;
    const leadDbId = row?.entityId;
    if (!fromCounselorId || !leadDbId) continue;
    const lead = leadById.get(leadDbId);
    const toCounselor = toCounselorId ? counselorById.get(toCounselorId) : null;
    const arr = reassignedByFromCounselor.get(fromCounselorId) || [];
    arr.push({
      id: leadDbId,
      leadId: lead?.leadId || null,
      studentName: lead?.studentName || null,
      toCounselorId: toCounselorId || null,
      toCounselorName: toCounselor?.fullName || null,
      createdAt: row?.createdAt || null,
    });
    reassignedByFromCounselor.set(fromCounselorId, arr);
  }

  // Calculate inactivity and format alerts
  const allAlerts = [];
  for (const presence of inactiveCounselors) {
    const lastActivity = new Date(presence.lastActivityAt || presence.lastLoginAt || presence.lastStatusChange);
    const inactiveMinutes = Math.floor((now - lastActivity) / (1000 * 60));

    // Only consider leads that are NEW, untouched (no calls), and older than 4 hours
    const leadIds = (presence.counselor?.assignedLeads || []).map((l) => l.id);
    let trulyAffected = [];
    if (leadIds.length > 0) {
      const leads = await prisma.lead.findMany({
        where: {
          id: { in: leadIds },
          status: 'NEW',
          submittedAt: { lt: new Date(now.getTime() - 4 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      const touched = await prisma.leadCall.findMany({
        where: { leadId: { in: leads.map((l) => l.id) } },
        select: { leadId: true },
      });
      const calledSet = new Set(touched.map((c) => c.leadId));
      const affectedSet = new Set(leads.filter((l) => !calledSet.has(l.id)).map((l) => l.id));
      trulyAffected = (presence.counselor?.assignedLeads || []).filter((l) => affectedSet.has(l.id));
    }

    const affectedCount = trulyAffected.length;
    const requiresReassignment = inactiveMinutes >= 240 && affectedCount > 0;
    const reassignedLeads = reassignedByFromCounselor.get(presence.counselorId) || [];
    const autoReassigned = reassignedLeads.length;

    allAlerts.push({
      counselorId: presence.counselorId,
      counselorName: presence.counselor.fullName,
      email: presence.counselor.user.email,
      currentStatus: inactiveMinutes >= 240 ? 'INACTIVE' : presence.status,
      inactiveMinutes,
      lastActivityAt: presence.lastActivityAt,
      lastLoginAt: presence.lastLoginAt,
      affectedLeads: affectedCount,
      leads: trulyAffected,
      requiresReassignment,
      autoReassigned,
      reassignedLeads,
    });
  }

  // Only return alerts that require action (have leads to reassign)
  // Keep alert visible even after auto-reassignment (so admin sees what happened)
  const alerts = allAlerts.filter((a) => a.requiresReassignment || (a.autoReassigned || 0) > 0);

  res.json({
    success: true,
    data: {
      alerts,
      total: alerts.length,
      critical: alerts.length
    }
  });
}));

export default router;
