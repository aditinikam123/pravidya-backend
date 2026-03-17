/**
 * Parent Feedback: send form link, form by token, submit, analytics
 */
import express from 'express';
import crypto from 'crypto';
import { body, validationResult } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';
import { sendMail } from '../utils/email.js';

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || process.env.VITE_APP_URL || 'http://localhost:5173';
// Optional: base URL of the standalone Parent Feedback Form (if deployed separately). If set, email link uses this.
const FEEDBACK_FORM_URL = process.env.FEEDBACK_FORM_URL || FRONTEND_URL;

function generateFeedbackToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Build feedback form URL for a lead (email link)
function getFeedbackFormUrl(token) {
  return `${FEEDBACK_FORM_URL.replace(/\/$/, '')}/feedback/${token}`;
}

// Email body for feedback form
function getFeedbackEmailBody(link) {
  return `
Hello,

Thank you for attending counseling with Pravidya.

Please click the link below to share your feedback:

${link}

Regards,
Team Pravidya
  `.trim();
}

// POST /api/feedback/send — counselor sends feedback form to parent (manual)
router.post(
  '/send',
  authenticate,
  authorize('ADMIN', 'COUNSELOR'),
  body('leadId').notEmpty().withMessage('Lead ID is required'),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: 'Lead ID required', errors: errors.array() });
    const { leadId } = req.body;

    let counselorId = null;
    if (req.user.role === 'COUNSELOR') {
      const profile = await prisma.counselorProfile.findFirst({ where: { userId: req.userId } });
      if (!profile) return res.status(403).json({ success: false, message: 'Counselor profile not found' });
      counselorId = profile.id;
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { institution: { select: { name: true } }, assignedCounselor: { select: { fullName: true } } },
    });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    // Allow if counselor is assigned to the lead OR has conducted any session for this lead
    if (counselorId && lead.assignedCounselorId !== counselorId) {
      const conductedSession = await prisma.counselingSession.findFirst({
        where: { leadId, counselorId },
      });
      if (!conductedSession) {
        return res.status(403).json({ success: false, message: 'Not assigned to this lead' });
      }
    }

    const parentEmail = (lead.parentEmail || '').trim();
    if (!parentEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) {
      return res.status(400).json({
        success: false,
        message: 'This lead has no valid parent email. Add a valid Gmail/email in the lead details and try again.',
      });
    }

    let token = lead.feedbackToken;
    if (!token) {
      token = generateFeedbackToken();
      await prisma.lead.update({ where: { id: leadId }, data: { feedbackToken: token } });
    }

    const link = getFeedbackFormUrl(token);
    try {
      await sendMail({
        to: parentEmail,
        subject: 'Pravidya Counseling Feedback Form',
        text: getFeedbackEmailBody(link),
        html: getFeedbackEmailBody(link).replace(/\n/g, '<br>'),
      });
    } catch (err) {
      const errMsg = err.message || String(err);
      console.error('[feedback/send] Email failed:', errMsg);
      if (err.response) console.error('[feedback/send] SMTP response:', err.response);
      return res.status(503).json({
        success: false,
        message: 'Could not send email. Check server SMTP settings (for Gmail use an App Password).',
        error: errMsg,
      });
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: { feedbackStatus: 'SENT', feedbackSentAt: new Date() },
    });

    res.json({ success: true, message: 'Feedback form sent successfully to parent' });
  })
);

// Helper: get counselor name for form — prefer counselor from most recent completed session (who conducted/sent feedback)
async function getCounselorNameForForm(lead) {
  const lastCompleted = await prisma.counselingSession.findFirst({
    where: { leadId: lead.id, status: 'COMPLETED' },
    orderBy: { scheduledDate: 'desc' },
    include: { counselor: { select: { fullName: true } } },
  });
  return lastCompleted?.counselor?.fullName ?? lead.assignedCounselor?.fullName ?? null;
}

// Helper: get counselor id for saving feedback — required by ParentFeedback; prefer session counselor
async function getCounselorIdForFeedback(lead) {
  const lastCompleted = await prisma.counselingSession.findFirst({
    where: { leadId: lead.id, status: 'COMPLETED' },
    orderBy: { scheduledDate: 'desc' },
    select: { counselorId: true },
  });
  return lastCompleted?.counselorId ?? lead.assignedCounselorId ?? null;
}

// GET /api/feedback/form/:token — public: get lead + institution + counselor for form (read-only)
router.get(
  '/form/:token',
  asyncHandler(async (req, res) => {
    const lead = await prisma.lead.findFirst({
      where: { feedbackToken: req.params.token },
      include: {
        institution: { select: { id: true, name: true } },
        assignedCounselor: { select: { id: true, fullName: true } },
      },
    });
    if (!lead) return res.status(404).json({ success: false, message: 'Invalid or expired link' });
    if (lead.feedbackStatus === 'SUBMITTED') return res.status(400).json({ success: false, message: 'Feedback already submitted' });

    const counselorName = await getCounselorNameForForm(lead);

    res.json({
      success: true,
      data: {
        studentName: lead.studentName,
        parentName: lead.parentName,
        email: lead.parentEmail,
        phone: lead.parentMobile,
        institutionName: lead.institution?.name,
        counselorName,
        leadId: lead.id,
        token: lead.feedbackToken,
      },
    });
  })
);

// GET /api/feedback/form-by-lead/:leadId — public: get form data by lead id (for links using lead id instead of token)
router.get(
  '/form-by-lead/:leadId',
  asyncHandler(async (req, res) => {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.leadId },
      include: {
        institution: { select: { id: true, name: true } },
        assignedCounselor: { select: { id: true, fullName: true } },
      },
    });
    if (!lead) return res.status(404).json({ success: false, message: 'Invalid or expired feedback link' });
    if (!lead.feedbackToken) return res.status(400).json({ success: false, message: 'Feedback link not generated for this lead' });
    if (lead.feedbackStatus === 'SUBMITTED') return res.status(400).json({ success: false, message: 'Feedback already submitted' });

    const counselorName = await getCounselorNameForForm(lead);

    res.json({
      success: true,
      data: {
        studentName: lead.studentName,
        parentName: lead.parentName,
        email: lead.parentEmail,
        phone: lead.parentMobile,
        institutionName: lead.institution?.name,
        counselorName,
        leadId: lead.id,
        token: lead.feedbackToken,
      },
    });
  })
);

// POST /api/feedback/submit — public: submit feedback form (by token in body)
router.post(
  '/submit',
  body('token').notEmpty(),
  body('experienceRating').isInt({ min: 1, max: 5 }),
  body('explanationRating').isInt({ min: 1, max: 5 }),
  body('helpfulnessRating').isInt({ min: 1, max: 5 }),
  body('questionsAnswered').isBoolean(),
  body('professionalismRating').isInt({ min: 1, max: 5 }),
  body('interestLevel').isIn(['Very Interested', 'Interested', 'Not Sure', 'Not Interested']),
  body('admissionDecision').isIn(['Ready to take admission', 'Need more time', 'Exploring other institutions', 'Not interested']),
  body('recommend').isBoolean(),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const msg = errors.array().map((e) => e.msg).join('; ') || 'Validation failed';
      return res.status(400).json({ success: false, message: msg, errors: errors.array() });
    }

    const lead = await prisma.lead.findFirst({
      where: { feedbackToken: req.body.token },
      include: { institution: true, assignedCounselor: true },
    });
    if (!lead) return res.status(404).json({ success: false, message: 'Invalid or expired link' });
    if (lead.feedbackStatus === 'SUBMITTED') return res.status(400).json({ success: false, message: 'Feedback already submitted' });

    const concern = req.body.interestLevel === 'Not Interested' ? (req.body.concern || null) : null;

    const counselorId = await getCounselorIdForFeedback(lead);
    if (!counselorId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot save feedback: no counselor is associated with this session. Please contact support.',
      });
    }

    await prisma.parentFeedback.create({
      data: {
        leadId: lead.id,
        studentName: lead.studentName,
        parentName: lead.parentName,
        email: lead.parentEmail,
        phone: lead.parentMobile,
        counselorId,
        institutionId: lead.institutionId,
        experienceRating: req.body.experienceRating,
        explanationRating: req.body.explanationRating,
        helpfulnessRating: req.body.helpfulnessRating,
        questionsAnswered: req.body.questionsAnswered,
        professionalismRating: req.body.professionalismRating,
        interestLevel: req.body.interestLevel,
        admissionDecision: req.body.admissionDecision,
        concern,
        likedFeedback: req.body.likedFeedback || null,
        improvementFeedback: req.body.improvementFeedback || null,
        recommend: req.body.recommend,
      },
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data: { feedbackStatus: 'SUBMITTED', feedbackSubmittedAt: new Date() },
    });

    res.json({ success: true, message: 'Thank you for your feedback' });
  })
);

// GET /api/feedback/analytics — management: cards + chart data
router.get(
  '/analytics',
  authenticate,
  authorize('ADMIN', 'MANAGEMENT'),
  asyncHandler(async (req, res) => {
    const feedback = await prisma.parentFeedback.findMany({
      include: { lead: true, counselor: { select: { fullName: true } }, institution: { select: { name: true } } },
    });
    const n = feedback.length;
    if (n === 0) {
      return res.json({
        success: true,
        data: {
          totalFeedback: 0,
          averageRating: 0,
          interestedPct: 0,
          notInterestedPct: 0,
          readyForAdmissionPct: 0,
          recommendationPct: 0,
          interestDistribution: [],
          admissionDistribution: [],
          counselorPerformance: [],
          institutionInterest: [],
          recommendationRate: [],
        },
      });
    }

    const ratings = feedback.flatMap((f) => [f.experienceRating, f.explanationRating, f.helpfulnessRating, f.professionalismRating]);
    const avgRating = (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1);
    const interested = feedback.filter((f) => ['Very Interested', 'Interested'].includes(f.interestLevel)).length;
    const notInterested = feedback.filter((f) => f.interestLevel === 'Not Interested').length;
    const readyAdmission = feedback.filter((f) => f.admissionDecision === 'Ready to take admission').length;
    const recommend = feedback.filter((f) => f.recommend).length;

    const interestCounts = {};
    const admissionCounts = {};
    const counselorRatings = {};
    const institutionCounts = {};
    feedback.forEach((f) => {
      interestCounts[f.interestLevel] = (interestCounts[f.interestLevel] || 0) + 1;
      admissionCounts[f.admissionDecision] = (admissionCounts[f.admissionDecision] || 0) + 1;
      const name = f.counselor?.fullName || 'Unknown';
      if (!counselorRatings[name]) counselorRatings[name] = [];
      counselorRatings[name].push((f.experienceRating + f.explanationRating + f.helpfulnessRating + f.professionalismRating) / 4);
      const inst = f.institution?.name || 'Unknown';
      institutionCounts[inst] = (institutionCounts[inst] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        totalFeedback: n,
        averageRating: parseFloat(avgRating),
        interestedPct: ((interested / n) * 100).toFixed(1),
        notInterestedPct: ((notInterested / n) * 100).toFixed(1),
        readyForAdmissionPct: ((readyAdmission / n) * 100).toFixed(1),
        recommendationPct: ((recommend / n) * 100).toFixed(1),
        interestDistribution: Object.entries(interestCounts).map(([name, value]) => ({ name, value })),
        admissionDistribution: Object.entries(admissionCounts).map(([name, value]) => ({ name, value })),
        counselorPerformance: Object.entries(counselorRatings).map(([name, arr]) => ({
          name,
          avgRating: (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1),
          count: arr.length,
        })),
        institutionInterest: Object.entries(institutionCounts).map(([name, count]) => ({ name, count })),
        recommendationRate: [
          { name: 'Yes', value: recommend },
          { name: 'No', value: n - recommend },
        ],
      },
    });
  })
);

// GET /api/feedback — management: list with pagination
router.get(
  '/',
  authenticate,
  authorize('ADMIN', 'MANAGEMENT'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [list, total] = await Promise.all([
      prisma.parentFeedback.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          counselor: { select: { fullName: true } },
          institution: { select: { name: true } },
        },
      }),
      prisma.parentFeedback.count(),
    ]);

    res.json({
      success: true,
      data: {
        feedback: list,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  })
);

// GET /api/feedback/:id — management: single feedback (view full)
router.get(
  '/:id',
  authenticate,
  authorize('ADMIN', 'MANAGEMENT'),
  asyncHandler(async (req, res) => {
    const fb = await prisma.parentFeedback.findUnique({
      where: { id: req.params.id },
      include: {
        lead: { select: { leadId: true, parentEmail: true } },
        counselor: { select: { fullName: true, mobile: true } },
        institution: { select: { name: true } },
      },
    });
    if (!fb) return res.status(404).json({ success: false, message: 'Feedback not found' });
    res.json({ success: true, data: fb });
  })
);

export default router;
