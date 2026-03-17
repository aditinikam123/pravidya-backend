/**
 * Voice Call Lead Update - Counselor only.
 * Master options (dropdowns), save call log, call history by lead.
 */
import express from 'express';
import { body, validationResult } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';
import { DEFAULT_MASTER_OPTIONS } from '../data/masterOptionsSeed.js';

const router = express.Router();

// @route   GET /api/counselor/voice-call/master-options
// @query   category (optional, can repeat) e.g. ?category=passing_year&category=loan_required
// @access  Counselor only
router.get(
  '/master-options',
  authenticate,
  authorize('COUNSELOR'),
  asyncHandler(async (req, res) => {
    let byCategory = {};
    // Categories: prefer comma-separated string (categories=a,b,c), else category array/string
    let categories = req.query.categories != null
      ? String(req.query.categories).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    if (categories.length === 0) {
      const cat = req.query.category;
      if (cat != null) {
        if (Array.isArray(cat)) categories = [...cat];
        else if (typeof cat === 'object') categories = Object.values(cat);
        else categories = [String(cat)];
      }
      categories = categories.filter(Boolean);
    }

    try {
      const where = categories.length ? { category: { in: categories } } : {};
      let options = await prisma.masterOption.findMany({
        where,
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }]
      });
      // Auto-seed if table is completely empty
      if (options.length === 0) {
        await prisma.masterOption.createMany({ data: DEFAULT_MASTER_OPTIONS, skipDuplicates: true });
        options = await prisma.masterOption.findMany({
          where,
          orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }]
        });
      }
      options.forEach((o) => {
        if (!byCategory[o.category]) byCategory[o.category] = [];
        byCategory[o.category].push({ value: o.value, label: o.label });
      });
      // Ensure every requested category has options (fallback from defaults if DB missing new categories)
      const defaultByCategory = {};
      DEFAULT_MASTER_OPTIONS.forEach((o) => {
        if (!defaultByCategory[o.category]) defaultByCategory[o.category] = [];
        defaultByCategory[o.category].push({ value: o.value, label: o.label, sortOrder: o.sortOrder });
      })
      const requested = categories.length ? categories : Object.keys(defaultByCategory);
      requested.forEach((cat) => {
        if (!byCategory[cat] || byCategory[cat].length === 0) {
          const list = (defaultByCategory[cat] || [])
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map(({ value, label }) => ({ value, label }));
          byCategory[cat] = list;
        }
      });
    } catch (err) {
      // Table may not exist yet; return options from defaults so dropdowns still work
      byCategory = {};
      const categories = [].concat(req.query.category || []).filter(Boolean);
      const defaultByCategory = {};
      DEFAULT_MASTER_OPTIONS.forEach((o) => {
        if (!defaultByCategory[o.category]) defaultByCategory[o.category] = [];
        defaultByCategory[o.category].push({ value: o.value, label: o.label, sortOrder: o.sortOrder });
      });
      const requested = categories.length ? categories : Object.keys(defaultByCategory);
      requested.forEach((cat) => {
        const list = (defaultByCategory[cat] || [])
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          .map(({ value, label }) => ({ value, label }));
        byCategory[cat] = list;
      });
    }
    res.json({ success: true, data: byCategory });
  })
);

// @route   GET /api/counselor/voice-call/call-history/:leadId
// @desc    leadId = internal Lead.id (cuid)
// @access  Counselor only (own assigned leads)
router.get(
  '/call-history/:leadId',
  authenticate,
  authorize('COUNSELOR'),
  asyncHandler(async (req, res) => {
    const leadId = req.params.leadId;
    const counselorProfile = await prisma.counselorProfile.findUnique({
      where: { userId: req.userId }
    });
    if (!counselorProfile) {
      return res.status(403).json({ success: false, message: 'Counselor profile not found' });
    }
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, assignedCounselorId: true }
    });
    if (!lead || lead.assignedCounselorId !== counselorProfile.id) {
      return res.status(404).json({ success: false, message: 'Lead not found or not assigned to you' });
    }
    const logs = await prisma.callLog.findMany({
      where: { leadId },
      orderBy: { callTimestamp: 'desc' },
      take: 50,
      include: {
        counselor: { select: { fullName: true } }
      }
    });
    res.json({ success: true, data: { callHistory: logs } });
  })
);

// @route   POST /api/counselor/voice-call/save
// @body    leadId (internal id), callSummary, leadTemperature?, conversionProbability?,
//          formData (object), followUpRequired (bool), followUpDateTime?, followUpMode?
// @access  Counselor only
router.post(
  '/save',
  authenticate,
  authorize('COUNSELOR'),
  [
    body('leadId').notEmpty().withMessage('leadId is required'),
    body('callSummary').trim().notEmpty().withMessage('callSummary is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
    }
    const counselorProfile = await prisma.counselorProfile.findUnique({
      where: { userId: req.userId }
    });
    if (!counselorProfile) {
      return res.status(403).json({ success: false, message: 'Counselor profile not found' });
    }
    const {
      leadId,
      callSummary,
      leadTemperature,
      conversionProbability,
      formData,
      followUpRequired,
      followUpDateTime,
      followUpMode
    } = req.body;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, assignedCounselorId: true, notes: true }
    });
    if (!lead || lead.assignedCounselorId !== counselorProfile.id) {
      return res.status(404).json({ success: false, message: 'Lead not found or not assigned to you' });
    }

    const timelineEntry = `[${new Date().toISOString()}] Voice call: ${callSummary}`;
    const updatedNotes = [lead.notes, timelineEntry].filter(Boolean).join('\n\n');

    await prisma.$transaction(async (tx) => {
      const step1 = formData?.step1;
      await tx.lead.update({
        where: { id: leadId },
        data: {
          notes: updatedNotes,
          ...(step1 && {
            studentName: step1.studentName,
            parentName: step1.parentName,
            parentMobile: step1.parentContactNumber ?? step1.parentMobile,
            parentEmail: step1.parentEmail,
            parentCity: step1.parentCity,
            leadSource: step1.leadSource
          })
        }
      });

      await tx.callLog.create({
        data: {
          leadId,
          counselorId: counselorProfile.id,
          callSummary,
          leadTemperature: leadTemperature || null,
          conversionProbability: conversionProbability != null ? parseInt(conversionProbability, 10) : null,
          formData: formData || null
        }
      });

      if (followUpRequired && followUpDateTime) {
        const user = await tx.user.findFirst({
          where: { counselorProfile: { id: counselorProfile.id } },
          select: { id: true }
        });
        if (user) {
          await tx.todo.create({
            data: {
              userId: user.id,
              leadId,
              title: 'Voice call follow-up',
              description: `Follow-up: ${followUpMode || 'Call'}. Call summary: ${callSummary.slice(0, 200)}${callSummary.length > 200 ? '...' : ''}`,
              dueDate: new Date(followUpDateTime),
              status: 'PENDING',
              priority: 'MEDIUM'
            }
          });
        }
      }
    });

    res.json({ success: true, message: 'Call update saved successfully' });
  })
);

export default router;
