import crypto from 'crypto';
import { prisma } from '../prisma/client.js';

const LEAD_SOURCE_WHATSAPP = 'whatsapp_direct';
const VALID_SOURCE = LEAD_SOURCE_WHATSAPP;

/**
 * Verify Meta webhook signature (X-Hub-Signature-256).
 * @param {string} rawBody - Raw request body as string or Buffer
 * @param {string} signature - X-Hub-Signature-256 header value
 * @param {string} appSecret - META_APP_SECRET
 * @returns {boolean}
 */
export function verifyWebhookSignature(rawBody, signature, appSecret) {
  if (!signature || !appSecret) return false;
  const body = typeof rawBody === 'string' ? rawBody : (rawBody && rawBody.toString ? rawBody.toString('utf8') : '');
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(body).digest('hex');
  if (signature.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Normalize WhatsApp phone number for storage and lookup (digits only, with country code).
 * @param {string} from - e.g. "918123456789"
 * @returns {string}
 */
function normalizePhone(from) {
  const digits = String(from || '').replace(/\D/g, '');
  return digits || '';
}

/**
 * Get first active institution ID for WhatsApp leads (required by Lead schema).
 * @returns {Promise<string|null>}
 */
async function getDefaultInstitutionId() {
  const inst = await prisma.institution.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  return inst?.id ?? null;
}

/**
 * Generate next leadId (LEAD-YYYYMMDD-NNNN).
 * @returns {Promise<string>}
 */
async function getNextLeadId() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `LEAD-${dateStr}-`;
  const todayLeads = await prisma.lead.findMany({
    where: { leadId: { startsWith: prefix } },
    select: { leadId: true },
  });
  let maxSeq = 0;
  for (const l of todayLeads) {
    const num = parseInt(l.leadId?.slice(prefix.length) || '0', 10);
    if (!isNaN(num)) maxSeq = Math.max(maxSeq, num);
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

/**
 * Process incoming WhatsApp message: create lead or update last contact (duplicate by phone).
 * @param {object} params
 * @param {string} params.phone - Sender phone (with country code)
 * @param {string} params.messageText - Message body
 * @param {string} [params.timestamp] - Message timestamp
 * @returns {Promise<{ created: boolean, leadId?: string, updated?: boolean }>}
 */
export async function processIncomingMessage({ phone, messageText, timestamp }) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new Error('Invalid phone number');
  }

  const existing = await prisma.lead.findFirst({
    where: { parentMobile: normalizedPhone },
    select: { id: true, leadId: true },
  });

  if (existing) {
    await prisma.lead.update({
      where: { id: existing.id },
      data: { updatedAt: new Date() },
    });
    return { created: false, updated: true, leadId: existing.leadId };
  }

  const institutionId = await getDefaultInstitutionId();
  if (!institutionId) {
    throw new Error('No active institution found. Add at least one institution in Admin.');
  }

  const leadId = await getNextLeadId();
  const currentYear = String(new Date().getFullYear());
  const notes = (messageText || '').trim().slice(0, 2000) || null;

  const trackingKeys = ['source', 'medium', 'campaign', 'utm_source', 'utm_medium', 'utm_campaign', 'fbclid'];
  const dataWithTracking = {
    leadId,
    parentName: 'WhatsApp User',
    parentMobile: normalizedPhone,
    parentEmail: 'whatsapp@lead.local',
    parentCity: '—',
    preferredLanguage: 'English',
    studentName: '—',
    dateOfBirth: new Date('2000-01-01'),
    gender: 'Other',
    currentClass: 'WhatsApp Enquiry',
    boardUniversity: null,
    marksPercentage: null,
    institutionId,
    courseId: null,
    importedCourseName: null,
    academicYear: currentYear,
    preferredCounselingMode: null,
    notes,
    consent: false,
    classification: 'NEW',
    priority: 'NORMAL',
    status: 'NEW',
    source: VALID_SOURCE,
    medium: 'whatsapp',
    campaign: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    fbclid: null,
  };
  const dataWithoutTracking = { ...dataWithTracking };
  trackingKeys.forEach((k) => delete dataWithoutTracking[k]);

  try {
    await prisma.lead.create({ data: dataWithTracking });
  } catch (_) {
    await prisma.lead.create({ data: dataWithoutTracking });
  }

  return { created: true, leadId };
}

/**
 * Parse Meta webhook payload and extract message entries.
 * @param {object} body - Parsed JSON webhook body
 * @returns {Array<{ phone: string, messageText: string, timestamp: string }>}
 */
export function parseWebhookPayload(body) {
  const entries = [];
  if (!body || body.object !== 'whatsapp_business_account') return entries;
  const entryList = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entryList) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      if (!value || !value.messages) continue;
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const msg of messages) {
        const from = msg.from;
        let messageText = '';
        if (msg.type === 'text' && msg.text && typeof msg.text.body === 'string') {
          messageText = msg.text.body;
        }
        entries.push({
          phone: String(from || ''),
          messageText,
          timestamp: msg.timestamp ? String(msg.timestamp) : '',
        });
      }
    }
  }
  return entries;
}
