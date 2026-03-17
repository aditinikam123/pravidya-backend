/**
 * Auto-send feedback form 3 hours after counseling_completed_at (when feedback_status = NOT_SENT).
 * Run every 5 minutes from server.
 */
import { prisma } from '../prisma/client.js';
import { sendMail } from '../utils/email.js';

const FRONTEND_URL = process.env.FRONTEND_URL || process.env.VITE_APP_URL || 'http://localhost:5173';

function getFeedbackFormUrl(token) {
  return `${FRONTEND_URL.replace(/\/$/, '')}/feedback/${token}`;
}

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

export async function runFeedbackAutoSend() {
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const allLeads = await prisma.lead.findMany({
    where: {
      feedbackStatus: 'NOT_SENT',
      counselingCompletedAt: { lte: threeHoursAgo },
    },
    include: { institution: true, assignedCounselor: true },
  });
  const leads = allLeads.filter((l) => l.feedbackToken && l.parentEmail && String(l.parentEmail).trim());
  for (const lead of leads) {
    try {
      await sendMail({
        to: lead.parentEmail,
        subject: 'Pravidya Counseling Feedback Form',
        text: getFeedbackEmailBody(getFeedbackFormUrl(lead.feedbackToken)),
        html: getFeedbackEmailBody(getFeedbackFormUrl(lead.feedbackToken)).replace(/\n/g, '<br>'),
      });
      await prisma.lead.update({
        where: { id: lead.id },
        data: { feedbackStatus: 'SENT', feedbackSentAt: new Date() },
      });
    } catch (e) {
      console.warn('[feedbackAutoSend] Failed for lead', lead.id, e.message);
    }
  }
}
