import { prisma } from '../prisma/client.js';
import { performanceBasedPick, languageBasedReassign } from '../services/leadAssignmentService.js';

const CHECK_EVERY_MINUTES = 5;
const INACTIVITY_HOURS = 4;

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function upsertAlert({ type, severity, title, message, dedupeKey, meta }) {
  const now = new Date();
  // If AdminAlert model is not present in the Prisma schema (e.g. older schema),
  // gracefully skip writing alerts instead of crashing the monitoring job.
  if (!prisma.adminAlert || (typeof prisma.adminAlert.create !== 'function')) {
    // eslint-disable-next-line no-console
    console.warn('[leadMonitoring] AdminAlert model not available in Prisma schema; skipping alert', {
      type,
      severity,
      title,
    });
    return null;
  }
  try {
    if (dedupeKey) {
      return await prisma.adminAlert.upsert({
        where: { dedupeKey },
        create: { type, severity, title, message, dedupeKey, meta: meta || null, createdAt: now },
        update: { message, meta: meta || null, resolvedAt: null },
      });
    }
  } catch (_) {
    // If dedupeKey is duplicated due to concurrent runs, fall through to create.
  }
  return await prisma.adminAlert.create({
    data: { type, severity, title, message, dedupeKey: dedupeKey || null, meta: meta || null, createdAt: now },
  });
}

export async function runLeadMonitoringJob() {
  const now = new Date();
  const cutoff = hoursAgo(INACTIVITY_HOURS);
  const actor = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true },
  });

  // 1) Lead unattended: NEW leads with no call logged within 4 hours.
  const unattendedLeads = await prisma.lead.findMany({
    where: {
      status: 'NEW',
      submittedAt: { lt: cutoff },
    },
    select: {
      id: true,
      leadId: true,
      preferredLanguage: true,
      assignedCounselorId: true,
      submittedAt: true,
    },
    take: 500,
    orderBy: { submittedAt: 'asc' },
  });

  const unattendedLeadIds = unattendedLeads.map((l) => l.id);
  const leadsWithCalls = unattendedLeadIds.length
    ? await prisma.leadCall.findMany({
        where: { leadId: { in: unattendedLeadIds } },
        select: { leadId: true },
      })
    : [];
  const calledSet = new Set(leadsWithCalls.map((c) => c.leadId));
  const trulyUnattended = unattendedLeads.filter((l) => !calledSet.has(l.id));

  if (trulyUnattended.length > 0) {
    await upsertAlert({
      type: 'LEAD_UNATTENDED',
      severity: 'CRITICAL',
      title: 'Unattended Leads',
      message: `${trulyUnattended.length} leads have not been contacted for more than ${INACTIVITY_HOURS} hours`,
      dedupeKey: `lead_unattended:${INACTIVITY_HOURS}h`,
      meta: { count: trulyUnattended.length, cutoffHours: INACTIVITY_HOURS, leadIds: trulyUnattended.slice(0, 50).map((l) => l.leadId) },
    });
  }

  // 2) Counselor inactivity: no activity for 4 hours (presence.lastActivityAt)
  const inactiveCounselors = await prisma.counselorProfile.findMany({
    where: { availability: 'ACTIVE' },
    select: {
      id: true,
      fullName: true,
      userId: true,
      presence: { select: { lastActivityAt: true, lastLoginAt: true, status: true, dailyAttendance: { where: { date: startOfToday() }, select: { status: true } } } },
    },
  });

  const inactiveBy4h = inactiveCounselors.filter((c) => {
    const absent = c.presence?.dailyAttendance?.some((a) => a?.status === 'ABSENT');
    if (absent) return true;
    const last = c.presence?.lastActivityAt || c.presence?.lastLoginAt;
    if (!last) return false;
    return new Date(last) < cutoff;
  });

  for (const c of inactiveBy4h) {
    await upsertAlert({
      type: 'COUNSELOR_INACTIVITY',
      severity: 'WARNING',
      title: 'Counselor Inactivity',
      message: `Counselor ${c.fullName} inactive for ${INACTIVITY_HOURS} hours`,
      dedupeKey: `counselor_inactive:${c.id}:${INACTIVITY_HOURS}h`,
      meta: {
        counselorId: c.id,
        counselorName: c.fullName,
        lastActivityAt: c.presence?.lastActivityAt,
        status: c.presence?.status,
        cutoffHours: INACTIVITY_HOURS,
      },
    });
  }

  // 3) Automatic reassignment
  // - If lead unattended for 4 hours: reassign (language-based) regardless of counselor status
  // - If counselor inactive for 4 hours: reassign their NEW leads (language-based)
  const inactiveCounselorIds = new Set(inactiveBy4h.map((c) => c.id));
  const toReassign = new Map(); // leadId -> reason

  for (const l of trulyUnattended) {
    toReassign.set(l.id, 'Lead reassigned automatically due to lead inactivity.');
  }

  if (inactiveCounselorIds.size > 0) {
    const leadsOfInactive = await prisma.lead.findMany({
      where: {
        status: 'NEW',
        assignedCounselorId: { in: Array.from(inactiveCounselorIds) },
      },
      select: { id: true, leadId: true, preferredLanguage: true, assignedCounselorId: true },
      take: 500,
      orderBy: { submittedAt: 'asc' },
    });
    for (const l of leadsOfInactive) {
      if (!toReassign.has(l.id)) toReassign.set(l.id, 'Lead reassigned automatically due to counselor inactivity.');
    }
  }

  let reassigned = 0;
  for (const [leadDbId, reason] of toReassign.entries()) {
    const lead = await prisma.lead.findUnique({ where: { id: leadDbId } });
    if (!lead) continue;

    // Prefer performance-based pick first; if that fails, fall back to language-based reassignment.
    let result = null;
    try {
      const perf = await performanceBasedPick(lead);
      if (perf?.counselor?.id) {
        result = {
          updated: await prisma.lead.update({
            where: { id: lead.id },
            data: {
              // Use relation-based update so it works with schemas
              // that don't expose assignedCounselorId as a writable scalar.
              assignedCounselor: { connect: { id: perf.counselor.id } },
              autoAssigned: true,
              assignmentReason: perf.assignmentReason || reason,
            },
          }),
          newCounselor: perf.counselor,
          assignmentReason: perf.assignmentReason,
        };
      }
    } catch {
      // ignore and fall back
    }

    if (!result?.updated?.id) {
      result = await languageBasedReassign(lead, reason);
    }
    if (!result?.updated?.id) continue;

    reassigned += 1;
    if (actor?.id) {
      await prisma.activityLog.create({
        data: {
          userId: actor.id,
          action: 'AUTO_REASSIGN_LEAD',
          entityType: 'LEAD',
          entityId: lead.id,
          details: {
            reason,
            fromCounselorId: lead.assignedCounselorId,
            toCounselorId: result.updated.assignedCounselorId,
            preferredLanguage: lead.preferredLanguage,
          },
        },
      });
    }

    await upsertAlert({
      type: 'LEAD_REASSIGNMENT',
      severity: 'WARNING',
      title: 'Lead Reassignment',
      message: `${lead.leadId || 'Lead'} reassigned automatically due to inactivity`,
      dedupeKey: `lead_reassign:${lead.id}:${Math.floor(now.getTime() / (60 * 60 * 1000))}`, // bucket by hour
      meta: {
        leadId: lead.leadId,
        leadDbId: lead.id,
        reason,
        fromCounselorId: lead.assignedCounselorId,
        toCounselorId: result.updated.assignedCounselorId,
      },
    });
  }

  return {
    unattended: trulyUnattended.length,
    inactiveCounselors: inactiveBy4h.length,
    reassigned,
    checkedAt: now.toISOString(),
    intervalMinutes: CHECK_EVERY_MINUTES,
  };
}

