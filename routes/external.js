import express from 'express';
import { body, validationResult } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../prisma/client.js';

const API_KEY = 'TRINITY123';

const router = express.Router();

// Middleware: require x-api-key header
const requireApiKey = (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or missing API key'
    });
  }
  next();
};

router.use(requireApiKey);

// @route   POST /api/external/college-enquiry
// @desc    Receive enquiry leads from external college websites (public, no login)
// @access  Public (requires x-api-key: TRINITY123)
router.post('/college-enquiry', [
  body('studentName').trim().notEmpty().withMessage('studentName is required'),
  body('phone').trim().notEmpty().withMessage('phone is required'),
  body('gradeInterested').trim().notEmpty().withMessage('gradeInterested is required'),
  body('enquiryCode').trim().optional(),
  body('institutionId').trim().optional(),
  body('sourceCollege').trim().optional(),
  body('parentName').trim().optional(),
  body('parentEmail').trim().optional().isEmail().withMessage('parentEmail must be valid if provided'),
  body('parentCity').trim().optional(),
  body('preferredLanguage').trim().optional(),
  body('dateOfBirth').optional().isISO8601().withMessage('dateOfBirth must be valid ISO date if provided'),
  body('gender').optional().isIn(['Male', 'Female', 'Other']),
  body('currentClass').trim().optional(),
  body('academicYear').trim().optional(),
  body('notes').trim().optional()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const first = errors.array()[0];
    return res.status(400).json({
      success: false,
      message: first?.msg || 'Validation failed',
      errors: errors.array()
    });
  }

  const {
    studentName,
    phone,
    gradeInterested,
    enquiryCode: bodyEnquiryCode,
    institutionId: bodyInstitutionId,
    sourceCollege,
    parentName,
    parentEmail,
    parentCity,
    preferredLanguage,
    dateOfBirth,
    gender,
    currentClass,
    academicYear,
    notes
  } = req.body;

  const isPlaceholder = !bodyInstitutionId || bodyInstitutionId === 'REPLACE_WITH_TRINITY_INSTITUTION_ID';

  let institution = null;
  if (bodyEnquiryCode && bodyEnquiryCode.trim()) {
    institution = await prisma.institution.findUnique({
      where: { enquiryCode: bodyEnquiryCode.trim() },
      select: { id: true, name: true }
    });
  }
  if (!institution && bodyInstitutionId && !isPlaceholder) {
    institution = await prisma.institution.findUnique({
      where: { id: bodyInstitutionId },
      select: { id: true, name: true }
    });
  }
  if (!institution && (sourceCollege || isPlaceholder)) {
    const collegeName = (sourceCollege || 'Trinity College').trim();
    institution = await prisma.institution.findFirst({
      where: { name: { equals: collegeName, mode: 'insensitive' } },
      select: { id: true, name: true }
    });
  }
  if (!institution) {
    return res.status(400).json({
      success: false,
      message: 'College not found. Use the Enquiry Code from Pravidya Admin → Institutions, or add the college there first.'
    });
  }
  const institutionId = institution.id;
  const institutionName = institution.name || sourceCollege || null;

  // Generate leadId (LEAD-YYYYMMDD-NNNN)
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `LEAD-${dateStr}-`;
  const todayLeads = await prisma.lead.findMany({
    where: { leadId: { startsWith: prefix } },
    select: { leadId: true }
  });
  let maxSeq = 0;
  for (const l of todayLeads) {
    const num = parseInt(l.leadId?.slice(prefix.length) || '0', 10);
    if (!isNaN(num)) maxSeq = Math.max(maxSeq, num);
  }
  const leadId = `LEAD-${dateStr}-${String(maxSeq + 1).padStart(4, '0')}`;

  const leadData = {
    leadId,
    parentName: (parentName || studentName || '—').trim(),
    parentMobile: phone.trim(),
    parentEmail: (parentEmail || 'external@college-enquiry.local').trim(),
    parentCity: (parentCity || '—').trim(),
    preferredLanguage: (preferredLanguage || 'English').trim(),
    studentName: studentName.trim(),
    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : new Date('2000-01-01'),
    gender: gender || 'Other',
    currentClass: (currentClass || gradeInterested).trim(),
    boardUniversity: null,
    marksPercentage: null,
    institutionId,
    courseId: null,
    importedCourseName: null,
    academicYear: (academicYear || String(new Date().getFullYear())).trim(),
    preferredCounselingMode: null,
    notes: notes ? notes.trim() : null,
    consent: true,
    classification: 'RAW',
    priority: 'NORMAL',
    status: 'NEW',
    assignedCounselorId: null,
    autoAssigned: false,
    assignmentReason: '',
    leadSource: 'College Website',
    sourceCollege: (institutionName || sourceCollege || '').trim() || null
  };

  await prisma.lead.create({
    data: leadData
  });

  res.status(201).json({
    success: true,
    message: 'Enquiry submitted successfully'
  });
}));

export default router;
