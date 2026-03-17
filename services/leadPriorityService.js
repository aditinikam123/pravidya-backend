/**
 * Lead priority service: HIGH_PRIORITY is set ONLY after first COMPLETED session
 * and only when qualification criteria are met. Priority is never manually editable.
 */

import { prisma } from '../prisma/client.js';

/**
 * Calculate whether lead should be marked HIGH_PRIORITY based on qualification fields.
 * Rule: intent=READY_TO_ENROLL AND timeline IN (IMMEDIATE, WITHIN_1_WEEK)
 *       AND budget_status IN (CONFIRMED, NEEDS_EMI) AND decision_maker=AVAILABLE
 *
 * @param {Object} lead - Lead with intent, timeline, budget_status, decision_maker
 * @returns {{ isHighPriority: boolean, newStatus?: string }}
 */
export function calculateHighPriority(lead) {
  const intent = lead.intent;
  const timeline = lead.timeline;
  const budgetStatus = lead.budget_status;
  const decisionMaker = lead.decision_maker;

  const intentOk = intent === 'READY_TO_ENROLL';
  const timelineOk = timeline === 'IMMEDIATE' || timeline === 'WITHIN_1_WEEK';
  const budgetOk = budgetStatus === 'CONFIRMED' || budgetStatus === 'NEEDS_EMI';
  const decisionMakerOk = decisionMaker === 'AVAILABLE';

  const isHighPriority = intentOk && timelineOk && budgetOk && decisionMakerOk;

  if (isHighPriority) {
    return { isHighPriority: true, newStatus: 'HIGH_PRIORITY' };
  }
  return { isHighPriority: false };
}

/**
 * Apply high-priority logic to a lead and persist. Does not change status to HIGH_PRIORITY
 * if criteria are not met; sets priority_flag and status accordingly.
 * Call after qualification form is submitted (lead already has intent, timeline, budget_status, decision_maker).
 *
 * @param {string} leadId - Lead ID
 * @returns {Promise<{ priority_flag: boolean, status: string }>}
 */
export async function applyHighPriorityLogic(leadId) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, intent: true, timeline: true, budget_status: true, decision_maker: true, status: true },
  });

  if (!lead) {
    throw new Error('Lead not found');
  }

  const { isHighPriority, newStatus } = calculateHighPriority(lead);

  const updateData = {
    priority_flag: isHighPriority,
  };
  if (isHighPriority) {
    updateData.status = 'HIGH_PRIORITY';
  }
  // If not high priority, keep existing status (do not set status field)

  await prisma.lead.update({
    where: { id: leadId },
    data: updateData,
  });

  return {
    priority_flag: updateData.priority_flag,
    status: isHighPriority ? newStatus : lead.status,
  };
}
