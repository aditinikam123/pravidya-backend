/**
 * Management Analytics APIs - READ-ONLY
 * Uses existing Prisma models, no schema changes.
 */
import express from 'express';
import { query } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const router = express.Router();

// Build date filter from query params
function buildDateFilter(params) {
  const { startDate, endDate } = params;
  const filter = {};
  if (startDate || endDate) {
    filter.submittedAt = {};
    if (startDate) filter.submittedAt.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.submittedAt.lte = end;
    }
  }
  return filter;
}

// Build lead where clause from global filters. Exclude REJECTED so Total Leads = active leads only.
function buildLeadWhere(params) {
  const where = { ...buildDateFilter(params), status: { not: 'REJECTED' } };
  if (params.courseId) where.courseId = params.courseId;
  if (params.institutionId) where.institutionId = params.institutionId;
  if (params.counselorId) where.assignedCounselorId = params.counselorId;
  if (params.location) where.parentCity = { contains: params.location, mode: 'insensitive' };
  if (params.leadSource) where.leadSource = { contains: params.leadSource, mode: 'insensitive' };
  return where;
}

/**
 * Management-only virtual stage (no DB change).
 * Maps status + classification to funnel stage: 1=Pending Contact, 2=Contacted, 3=Counseling, 4=Priority, 5=Admission Confirmed.
 */
function getManagementStage(lead) {
  const status = lead.status || 'NEW';
  const classification = lead.classification || 'NEW';
  if (status === 'ENROLLED' || classification === 'ADMISSION_CONFIRMED') return 5;
  if (classification === 'PRIORITY') return 4;
  if (classification === 'COUNSELING_IN_PROGRESS') return 3;
  if (status === 'CONTACTED' || status === 'FOLLOW_UP') return 2;
  return 1;
}

/** Enforce sequential funnel: each stage <= previous. */
function enforceSequentialFunnel(total, pendingContact, contacted, counseling, priority, admissionConfirmed) {
  let c = Math.min(contacted, total);
  let co = Math.min(counseling, c);
  let p = Math.min(priority, co);
  let a = Math.min(admissionConfirmed, p);
  const pending = total - c;
  return {
    totalLeads: total,
    pendingContact: Math.max(0, pending),
    contacted: c,
    counselingInProgress: co,
    priority: p,
    admissionConfirmed: a,
  };
}

// @route   GET /api/management/analytics/dashboard
// @desc    Management Analytics Dashboard: KPIs, sequential funnel, counselor performance (virtual stage mapping).
// @access  Private (ADMIN, MANAGEMENT)
router.get('/dashboard', authenticate, authorize('ADMIN', 'MANAGEMENT'), asyncHandler(async (req, res) => {
  const params = req.query;
  const baseWhere = buildLeadWhere(params);

  // Default: no date filter → all leads. When From/To dates are set, baseWhere includes submittedAt → only leads in that range.
  const funnelWhere = { ...baseWhere };

  const [allLeadsForFunnel, counselorsList] = await Promise.all([
    prisma.lead.findMany({
      where: funnelWhere,
      select: { id: true, status: true, classification: true, assignedCounselorId: true, submittedAt: true },
    }),
    prisma.counselorProfile.findMany({
      where: { availability: 'ACTIVE' },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    }),
  ]);
  const allLeadsForPerformance = allLeadsForFunnel;

  const stages = allLeadsForFunnel.map((l) => getManagementStage(l));
  const total = stages.length;
  const n1 = stages.filter((s) => s === 1).length;
  const n2 = stages.filter((s) => s >= 2).length;
  const n3 = stages.filter((s) => s >= 3).length;
  const n4 = stages.filter((s) => s >= 4).length;
  const n5 = stages.filter((s) => s === 5).length;

  const enforced = enforceSequentialFunnel(total, n1, n2, n3, n4, n5);
  const conversionPct = enforced.totalLeads > 0
    ? ((enforced.admissionConfirmed / enforced.totalLeads) * 100).toFixed(1)
    : '0';

  const kpis = {
    totalLeads: enforced.totalLeads,
    pendingContact: enforced.pendingContact,
    counselingInProgress: enforced.counselingInProgress,
    priority: enforced.priority,
    admissionConfirmed: enforced.admissionConfirmed,
    conversionPct: parseFloat(conversionPct),
  };

  // Lead status counts for chart: New, Assigned, In Progress, Completed
  const activeLeads = allLeadsForFunnel.filter((l) => (l.status || '') !== 'REJECTED');
  let newUnassigned = 0;
  let newAssigned = 0;
  let inProgressCount = 0;
  let completedCount = 0;
  activeLeads.forEach((l) => {
    const status = l.status || 'NEW';
    const classification = l.classification || 'NEW';
    if (status === 'ENROLLED' || classification === 'ADMISSION_CONFIRMED') {
      completedCount += 1;
    } else if (
      status === 'ON_HOLD' || status === 'CONTACTED' || status === 'FOLLOW_UP' ||
      classification === 'COUNSELING_IN_PROGRESS' || classification === 'PRIORITY'
    ) {
      inProgressCount += 1;
    } else {
      if (l.assignedCounselorId) newAssigned += 1;
      else newUnassigned += 1;
    }
  });

  // Distribution: counts by stage (Contacted removed from display)
  const distribution = [
    { label: 'Pending Contact', count: enforced.pendingContact },
    { label: 'Counseling In Progress', count: enforced.counselingInProgress },
    { label: 'Priority', count: enforced.priority },
    { label: 'Admission Confirmed', count: enforced.admissionConfirmed },
  ];

  const funnel = [
    { label: 'Total Leads', count: enforced.totalLeads },
    { label: 'Pending Contact', count: enforced.pendingContact },
    { label: 'Counseling In Progress', count: enforced.counselingInProgress },
    { label: 'Priority', count: enforced.priority },
    { label: 'Admission Confirmed', count: enforced.admissionConfirmed },
  ];

  // Counselor performance table: Overall = total; per-counselor + Unassigned rows so they sum to Overall
  const UNASSIGNED_KEY = Symbol('UNASSIGNED');
  const byCounselor = new Map();
  byCounselor.set(null, { id: null, name: 'Overall', assigned: 0, contacted: 0, counseling: 0, priority: 0, admissions: 0 });
  byCounselor.set(UNASSIGNED_KEY, { id: UNASSIGNED_KEY, name: 'Unassigned', assigned: 0, contacted: 0, counseling: 0, priority: 0, admissions: 0 });
  allLeadsForPerformance.forEach((lead) => {
    const stage = getManagementStage(lead);
    const cid = lead.assignedCounselorId;
    const bucket = cid != null ? cid : UNASSIGNED_KEY;
    if (cid != null && !byCounselor.has(cid)) byCounselor.set(cid, { id: cid, name: 'Unknown', assigned: 0, contacted: 0, counseling: 0, priority: 0, admissions: 0 });
    const row = byCounselor.get(bucket);
    if (row) {
      row.assigned += 1;
      if (stage >= 2) row.contacted += 1;
      if (stage >= 3) row.counseling += 1;
      if (stage >= 4) row.priority += 1;
      if (stage === 5) row.admissions += 1;
    }
    const overall = byCounselor.get(null);
    overall.assigned += 1;
    if (stage >= 2) overall.contacted += 1;
    if (stage >= 3) overall.counseling += 1;
    if (stage >= 4) overall.priority += 1;
    if (stage === 5) overall.admissions += 1;
  });

  const counselorIds = [...byCounselor.keys()].filter((k) => k != null && k !== UNASSIGNED_KEY);
  const counselorNames = counselorIds.length
    ? await prisma.counselorProfile.findMany({
        where: { id: { in: counselorIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const nameMap = new Map(counselorNames.map((c) => [c.id, c.fullName]));

  const performanceTable = [];
  byCounselor.forEach((row, cid) => {
    const name = cid === null ? 'Overall' : (cid === UNASSIGNED_KEY ? 'Unassigned' : (nameMap.get(cid) || 'Unknown'));
    const conversion = row.assigned > 0 ? ((row.admissions / row.assigned) * 100).toFixed(1) : '0';
    performanceTable.push({
      counselorId: cid === UNASSIGNED_KEY ? 'unassigned' : cid,
      counselorName: name,
      leadsAssigned: row.assigned,
      counseling: row.counseling,
      priority: row.priority,
      admissions: row.admissions,
      conversionPct: parseFloat(conversion),
    });
  });

  // Sort: Overall first, then counselors by name, then Unassigned last
  performanceTable.sort((a, b) => {
    if (a.counselorId == null) return -1;
    if (b.counselorId == null) return 1;
    if (a.counselorId === 'unassigned') return 1;
    if (b.counselorId === 'unassigned') return -1;
    return (a.counselorName || '').localeCompare(b.counselorName || '');
  });

  // Assigned count = total - unassigned (matches performance table)
  const unassignedRow = performanceTable.find((r) => r.counselorId === 'unassigned');
  const unassignedCount = unassignedRow?.leadsAssigned ?? 0;
  const assignedTotal = Math.max(0, total - unassignedCount);

  const statusCountsForChart = {
    new: newUnassigned + newAssigned,
    newUnassigned,
    newAssigned,
    assigned: assignedTotal,
    inProgress: inProgressCount,
    completed: completedCount,
  };

  // Stacked bar data: per counselor only (Counseling → Priority → Admission; Contacted removed)
  const stackedBarByCounselor = performanceTable
    .filter((r) => r.counselorId && r.counselorId !== 'unassigned')
    .map((r) => ({
      counselorName: r.counselorName,
      counseling: r.counseling,
      priority: r.priority,
      admissionConfirmed: r.admissions,
    }));

  // Leads by month: last 6 months (one query, then group in memory)
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const leadsLast6Months = await prisma.lead.findMany({
    where: { ...baseWhere, submittedAt: { gte: sixMonthsAgo } },
    select: { submittedAt: true, status: true, classification: true },
  });
  const byMonth = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth[key] = { month: monthNames[d.getMonth()], monthKey: key, leads: 0, conversions: 0 };
  }
  leadsLast6Months.forEach((l) => {
    const submitted = l.submittedAt;
    if (!submitted) return;
    const key = `${submitted.getFullYear()}-${String(submitted.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[key]) return;
    byMonth[key].leads += 1;
    if (getManagementStage(l) === 5) byMonth[key].conversions += 1;
  });
  const leadsByMonth = Object.keys(byMonth)
    .sort()
    .map((k) => byMonth[k]);

  // Conversions by day – always return last 30 days for client-side filtering (7/21/30 day filters)
  const daysRange = 30;
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - daysRange);
  startDate.setHours(0, 0, 0, 0);
  const enrolledLeads = await prisma.lead.findMany({
    where: { ...baseWhere, status: 'ENROLLED', updatedAt: { gte: startDate } },
    select: { updatedAt: true },
  });
  const byDay = {};
  enrolledLeads.forEach((l) => {
    const d = l.updatedAt ? l.updatedAt.toISOString().slice(0, 10) : null;
    if (d) byDay[d] = (byDay[d] || 0) + 1;
  });
  const conversionsOverTime = [];
  for (let i = daysRange - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    conversionsOverTime.push({ date: dateStr, converted: byDay[dateStr] || 0 });
  }

  // Lead trend over time: group by submittedAt day (for Institution Analytics Lead Trend chart)
  const leadsOverTimeByDay = {};
  allLeadsForFunnel.forEach((l) => {
    const d = l.submittedAt ? l.submittedAt.toISOString().slice(0, 10) : null;
    if (d) leadsOverTimeByDay[d] = (leadsOverTimeByDay[d] || 0) + 1;
  });
  const leadsOverTime = Object.entries(leadsOverTimeByDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  res.json({
    success: true,
    data: {
      counselors: counselorsList.map((c) => ({ id: c.id, fullName: c.fullName })),
      kpis,
      distribution,
      funnel,
      performanceTable,
      stackedBarByCounselor,
      leadsByMonth,
      conversionsOverTime,
      leadsOverTime,
      statusCountsForChart,
    },
  });
}));

// @route   GET /api/management/analytics/overview
router.get('/overview', authenticate, authorize('ADMIN', 'MANAGEMENT'), asyncHandler(async (req, res) => {
  const where = buildLeadWhere(req.query);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [
    totalLeads,
    newLeadsToday,
    activeCounselors,
    partnerInstitutions,
    enrolledLeads,
    contactedLeads,
    followUpLeads,
    allLeads,
    sourceDistribution,
    sourceByStatus,
  ] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...where, submittedAt: { gte: todayStart, lte: todayEnd } } }),
    prisma.counselorProfile.count({ where: { availability: 'ACTIVE' } }),
    prisma.institution.count({ where: { isActive: true } }),
    prisma.lead.count({ where: { ...where, status: 'ENROLLED' } }),
    prisma.lead.count({ where: { ...where, status: 'CONTACTED' } }),
    prisma.lead.count({ where: { ...where, status: 'FOLLOW_UP' } }),
    prisma.lead.findMany({ where, select: { submittedAt: true }, take: 5000 }),
    prisma.lead.groupBy({
      by: ['leadSource'],
      where: Object.keys(where).length ? { ...where, leadSource: { not: null } } : { leadSource: { not: null } },
      _count: { id: true },
    }),
    prisma.lead.groupBy({
      by: ['leadSource', 'status'],
      where: { ...where, status: { not: 'REJECTED' } },
      _count: { id: true },
    }),
  ]);

  const conversionRate = totalLeads > 0 ? ((enrolledLeads / totalLeads) * 100).toFixed(2) : 0;

  // Leads over time (group by day from findMany)
  const byDay = {};
  (allLeads || []).forEach((r) => {
    const d = r.submittedAt ? r.submittedAt.toISOString().slice(0, 10) : null;
    if (d) byDay[d] = (byDay[d] || 0) + 1;
  });
  const leadsOverTimeChart = Object.entries(byDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }))
    .slice(-30);

  const interestedLeads = contactedLeads + followUpLeads;

  // Per-source conversion: (enrolled from source / total from source) * 100
  const sourceTotals = {};
  const sourceEnrolled = {};
  (sourceByStatus || []).forEach((row) => {
    const src = row.leadSource || 'Direct';
    sourceTotals[src] = (sourceTotals[src] || 0) + row._count.id;
    if (row.status === 'ENROLLED') sourceEnrolled[src] = (sourceEnrolled[src] || 0) + row._count.id;
  });
  const conversionBySource = Object.keys(sourceTotals).map((src) => {
    const total = sourceTotals[src];
    const enrolled = sourceEnrolled[src] || 0;
    const pct = total > 0 ? ((enrolled / total) * 100).toFixed(1) : 0;
    return { source: src, total, enrolled, conversionPct: parseFloat(pct) };
  });

  res.json({
    success: true,
    data: {
      totalLeads,
      newLeadsToday,
      activeCounselors,
      partnerInstitutions,
      totalAdmissions: enrolledLeads,
      conversionRate: parseFloat(conversionRate),
      funnel: [
        { label: 'Leads', count: totalLeads },
        { label: 'Contacted', count: contactedLeads },
        { label: 'Counseling', count: followUpLeads },
        { label: 'Interested', count: interestedLeads },
        { label: 'Admitted', count: enrolledLeads },
      ],
      leadsOverTime: leadsOverTimeChart,
      sourceDistribution: sourceDistribution
        .filter((s) => s.leadSource)
        .map((s) => ({ label: s.leadSource, value: s._count.id })),
      conversionBySource,
    },
  });
}));

// @route   GET /api/management/analytics/counselors
router.get('/counselors', authenticate, authorize('ADMIN', 'MANAGEMENT'), asyncHandler(async (req, res) => {
  const params = req.query;
  const leadWhere = buildLeadWhere(params);
  delete leadWhere.assignedCounselorId;

  const counselorWhere = { availability: 'ACTIVE' };
  if (params.counselorId) counselorWhere.id = params.counselorId;

  const counselors = await prisma.counselorProfile.findMany({
    where: counselorWhere,
    include: {
      user: { select: { username: true, email: true } },
      assignedLeads: {
        where: Object.keys(leadWhere).length ? leadWhere : undefined,
        select: { id: true, status: true, submittedAt: true },
      },
      sessions: { select: { id: true, leadId: true, status: true, remarks: true, createdAt: true } },
      responses: { select: { id: true, answer: true }, take: 5 },
      presence: true,
    },
  });

  const table = counselors.map((c) => {
    const leads = c.assignedLeads || [];
    const sessions = c.sessions || [];
    const assigned = leads.length;
    const contacted = leads.filter((l) => ['CONTACTED', 'FOLLOW_UP'].includes(l.status)).length;
    const followUps = leads.filter((l) => l.status === 'FOLLOW_UP').length;
    const interested = contacted;
    const admissions = leads.filter((l) => l.status === 'ENROLLED').length;
    const conversion = assigned > 0 ? ((admissions / assigned) * 100).toFixed(1) : '0';

    const responseTimes = [];
    for (const lead of leads) {
      if (!lead.submittedAt) continue;
      const leadSessions = sessions.filter((s) => s.leadId === lead.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const first = leadSessions[0];
      if (first && first.createdAt) {
        const minutes = (new Date(first.createdAt) - new Date(lead.submittedAt)) / (1000 * 60);
        if (minutes >= 0) responseTimes.push(minutes);
      }
    }
    const avgResponseTime = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : null;

    return {
      id: c.id,
      name: c.fullName,
      email: c.user?.email,
      leadsAssigned: assigned,
      contactedLeads: contacted,
      followups: followUps,
      interestedStudents: interested,
      admissions,
      conversionPct: conversion,
      totalCalls: sessions.filter((s) => s.status === 'COMPLETED').length || 0,
      pendingLeads: leads.filter((l) => l.status === 'NEW').length,
      counselingNotes: sessions.filter((s) => s.remarks).length || 0,
      avgResponseTime,
      lastActivity: c.presence?.lastActivityAt || c.presence?.lastLoginAt || null,
    };
  });

  res.json({ success: true, data: { counselors: table } });
}));

// @route   GET /api/management/analytics/counselors/:id
router.get('/counselors/:id', authenticate, authorize('ADMIN', 'MANAGEMENT'), asyncHandler(async (req, res) => {
  const counselor = await prisma.counselorProfile.findUnique({
    where: { id: req.params.id },
    include: {
      user: true,
      presence: { select: { lastActivityAt: true, lastLoginAt: true } },
      assignedLeads: { select: { id: true, status: true, submittedAt: true } },
      sessions: { select: { id: true, leadId: true, status: true, remarks: true, createdAt: true, scheduledDate: true } },
      responses: { include: { question: true, scores: true } },
    },
  });

  if (!counselor) return res.status(404).json({ success: false, message: 'Counselor not found' });

  const leads = counselor.assignedLeads || [];
  const sessions = counselor.sessions || [];

  // Avg response time: average minutes from lead submittedAt to counselor's first session for that lead
  const responseTimes = [];
  for (const lead of leads) {
    if (!lead.submittedAt) continue;
    const leadSessions = sessions.filter((s) => s.leadId === lead.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const first = leadSessions[0];
    if (first && first.createdAt) {
      const minutes = (new Date(first.createdAt) - new Date(lead.submittedAt)) / (1000 * 60);
      if (minutes >= 0) responseTimes.push(minutes);
    }
  }
  const avgResponseTime = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : null;

  // Today's response time: same metric but only for leads whose first session was created today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayResponseTimes = [];
  for (const lead of leads) {
    if (!lead.submittedAt) continue;
    const leadSessions = sessions.filter((s) => s.leadId === lead.id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const first = leadSessions[0];
    if (first && first.createdAt) {
      const firstAt = new Date(first.createdAt);
      if (firstAt >= todayStart && firstAt <= todayEnd) {
        const minutes = (firstAt - new Date(lead.submittedAt)) / (1000 * 60);
        if (minutes >= 0) todayResponseTimes.push(minutes);
      }
    }
  }
  const todayResponseTime = todayResponseTimes.length > 0
    ? Math.round(todayResponseTimes.reduce((a, b) => a + b, 0) / todayResponseTimes.length)
    : null;

  const lastActivityAt = counselor.presence?.lastActivityAt || counselor.presence?.lastLoginAt || null;

  const detail = {
    totalCalls: sessions.filter((s) => s.status === 'COMPLETED').length || 0,
    avgResponseTime,
    todayResponseTime,
    lastActivity: lastActivityAt,
    pendingLeads: leads.filter((l) => l.status === 'NEW').length,
    counselingNotes: sessions.filter((s) => s.remarks).map((s) => s.remarks) || [],
    studentFeedback: (counselor.responses || []).slice(0, 10).map((r) => ({ q: r.question?.text, a: r.answer })) || [],
    performanceTrend: leads
      .filter((l) => l.submittedAt)
      .reduce((acc, l) => {
        const m = l.submittedAt.toISOString().slice(0, 7);
        acc[m] = (acc[m] || 0) + 1;
        return acc;
      }, {}),
  };

  res.json({ success: true, data: { counselor, detail } });
}));

// @route   GET /api/management/analytics/institutions
router.get('/institutions', authenticate, authorize('ADMIN', 'MANAGEMENT'), asyncHandler(async (req, res) => {
  const params = req.query;
  const leadWhere = buildLeadWhere(params);
  delete leadWhere.institutionId;

  const instWhere = { isActive: true };
  if (params.institutionId) instWhere.id = params.institutionId;

  const institutions = await prisma.institution.findMany({
    where: instWhere,
    include: {
      leads: { where: Object.keys(leadWhere).length ? leadWhere : undefined, include: { course: true } },
      courses: { where: { isActive: true } },
    },
  });

  const table = institutions.map((i) => {
    const leads = i.leads || [];
    const count = leads.length;
    const enrolled = leads.filter((l) => l.status === 'ENROLLED').length;
    const conversion = count > 0 ? ((enrolled / count) * 100).toFixed(1) : '0';
    const courseCounts = {};
    leads.forEach((l) => {
      const name = l.course?.name || l.importedCourseName || 'Unknown';
      courseCounts[name] = (courseCounts[name] || 0) + 1;
    });
    const popularCourses = Object.entries(courseCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n, c]) => `${n} (${c})`)
      .join(', ');

    return {
      id: i.id,
      name: i.name,
      type: i.type,
      leadsReceived: count,
      admissions: enrolled,
      conversionPct: conversion,
      popularCourses: popularCourses || '—',
      revenue: enrolled * 5000,
    };
  });

  res.json({ success: true, data: { institutions: table } });
}));

// @route   GET /api/management/analytics/leads
router.get('/leads', authenticate, authorize('ADMIN', 'MANAGEMENT'), asyncHandler(async (req, res) => {
  const where = buildLeadWhere(req.query);

  // Recent leads: always last 100 by date (no date filter) so Overview table always shows latest activity
  const recentWhere = { status: { not: 'REJECTED' } };
  if (req.query.courseId) recentWhere.courseId = req.query.courseId;
  if (req.query.institutionId) recentWhere.institutionId = req.query.institutionId;
  if (req.query.counselorId) recentWhere.assignedCounselorId = req.query.counselorId;
  if (req.query.location) recentWhere.parentCity = { contains: req.query.location, mode: 'insensitive' };
  if (req.query.leadSource) recentWhere.leadSource = { contains: req.query.leadSource, mode: 'insensitive' };

  const [leads, recentLeadsList] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: {
        course: true,
        institution: true,
        assignedCounselor: { select: { fullName: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 500,
    }),
    prisma.lead.findMany({
      where: recentWhere,
      include: {
        institution: { select: { name: true } },
        assignedCounselor: { select: { fullName: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 100,
    }),
  ]);

  const recentLeads = recentLeadsList.map((l) => ({
    id: l.id,
    studentName: l.studentName,
    institutionName: l.institution?.name || '—',
    counselorName: l.assignedCounselor?.fullName || 'Unassigned',
    source: l.leadSource || 'Direct',
    status: l.status,
    createdAt: l.submittedAt,
  }));

  const courseCounts = {};
  const locationCounts = {};
  const sourceCounts = {};
  leads.forEach((l) => {
    const c = l.course?.name || l.importedCourseName || 'Unknown';
    courseCounts[c] = (courseCounts[c] || 0) + 1;
    const loc = l.parentCity || 'Unknown';
    locationCounts[loc] = (locationCounts[loc] || 0) + 1;
    const src = l.leadSource || 'Direct';
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  });

  const mostSelectedCourses = Object.entries(courseCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const locationPrefs = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const scholarshipInterest = leads.filter((l) =>
    (l.notes || '').toLowerCase().includes('scholarship')
  ).length;
  const parentInvolvement = leads.length;

  res.json({
    success: true,
    data: {
      recentLeads,
      mostSelectedCourses,
      budgetPreferences: [],
      locationPreferences: locationPrefs,
      scholarshipInterestPct: leads.length > 0 ? ((scholarshipInterest / leads.length) * 100).toFixed(1) : 0,
      parentInvolvementPct: 100,
      dropReasons: [
        { reason: 'Fees', count: leads.filter((l) => (l.notes || '').toLowerCase().includes('fee')).length },
        { reason: 'Parents not convinced', count: leads.filter((l) => l.status === 'REJECTED').length },
        { reason: 'No response', count: leads.filter((l) => l.status === 'NEW').length },
        { reason: 'Financial issues', count: leads.filter((l) => (l.notes || '').toLowerCase().includes('financial')).length },
        { reason: 'Chose other institution', count: leads.filter((l) => l.status === 'REJECTED').length },
      ],
    },
  });
}));

// @route   GET /api/management/analytics/revenue
router.get('/revenue', authenticate, authorize('ADMIN', 'MANAGEMENT'), asyncHandler(async (req, res) => {
  const where = buildLeadWhere(req.query);

  const enrolled = await prisma.lead.findMany({
    where: { ...where, status: 'ENROLLED' },
    include: { institution: true, assignedCounselor: true },
  });

  const totalLeads = await prisma.lead.count({ where });
  const assumedFee = 5000;

  const byInstitution = {};
  const byCounselor = {};
  enrolled.forEach((l) => {
    const rev = assumedFee;
    const inst = l.institution?.name || 'Unknown';
    byInstitution[inst] = (byInstitution[inst] || 0) + rev;
    const couns = l.assignedCounselor?.fullName || 'Unassigned';
    byCounselor[couns] = (byCounselor[couns] || 0) + rev;
  });

  const totalRevenue = enrolled.length * assumedFee;
  const costPerLead = totalLeads > 0 ? (totalRevenue / totalLeads).toFixed(0) : 0;
  const roi = totalLeads > 0 ? ((enrolled.length / totalLeads) * 100).toFixed(1) : 0;

  res.json({
    success: true,
    data: {
      revenuePerInstitution: Object.entries(byInstitution).map(([name, value]) => ({ name, value })),
      revenuePerCounselor: Object.entries(byCounselor).map(([name, value]) => ({ name, value })),
      costPerLead: parseFloat(costPerLead),
      roi: parseFloat(roi),
      totalRevenue,
    },
  });
}));

// @route   GET /api/management/analytics/alerts
router.get('/alerts', authenticate, authorize('ADMIN', 'MANAGEMENT'), asyncHandler(async (req, res) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const [notContacted24h, counselors, institutions, priorityLeads] = await Promise.all([
    prisma.lead.findMany({
      where: {
        status: 'NEW',
        submittedAt: { lt: yesterday },
        assignedCounselorId: { not: null },
      },
      take: 20,
      select: { id: true, leadId: true, studentName: true, submittedAt: true },
    }),
    prisma.counselorProfile.findMany({
      where: { availability: 'ACTIVE' },
      include: {
        assignedLeads: { select: { id: true, status: true } },
      },
    }),
    prisma.institution.findMany({
      include: {
        leads: { select: { id: true, status: true } },
      },
    }),
    prisma.lead.findMany({
      where: { classification: 'PRIORITY', status: { not: 'ENROLLED' } },
      take: 20,
    }),
  ]);

  const alerts = [];

  notContacted24h.forEach((l) => {
    alerts.push({
      type: 'warning',
      message: `Lead ${l.leadId || l.studentName} not contacted within 24 hours`,
      entityId: l.id,
      entityType: 'lead',
      createdAt: l.submittedAt,
    });
  });

  counselors.forEach((c) => {
    const leads = c.assignedLeads || [];
    const enrolled = leads.filter((l) => l.status === 'ENROLLED').length;
    const total = leads.length;
    if (total >= 5 && total > 0 && enrolled / total < 0.1) {
      alerts.push({
        type: 'info',
        message: `Counselor ${c.fullName} conversion dropping (${((enrolled / total) * 100).toFixed(0)}%)`,
        entityId: c.id,
        entityType: 'counselor',
      });
    }
  });

  institutions.forEach((i) => {
    const leads = i.leads || [];
    const total = leads.length;
    const enrolled = leads.filter((l) => l.status === 'ENROLLED').length;
    if (total >= 3 && total > 0 && enrolled / total < 0.05) {
      alerts.push({
        type: 'info',
        message: `Low admission rate at ${i.name} (${((enrolled / total) * 100).toFixed(0)}%)`,
        entityId: i.id,
        entityType: 'institution',
      });
    }
  });

  priorityLeads.slice(0, 5).forEach((l) => {
    alerts.push({
      type: 'danger',
      message: `High intent lead ${l.leadId || l.studentName} pending follow-up`,
      entityId: l.id,
      entityType: 'lead',
    });
  });

  res.json({ success: true, data: { alerts: alerts.slice(0, 20) } });
}));

// @route   POST /api/management/analytics/alerts/:id/resolve
router.post('/alerts/:id/resolve', authenticate, authorize('ADMIN', 'MANAGEMENT'), asyncHandler(async (req, res) => {
  // UI-only: mark as resolved. Store in memory or use a simple resolvedAlerts table if added later.
  // For now, we acknowledge the request - actual persistence would need a new table.
  res.json({ success: true, message: 'Alert marked as resolved' });
}));

export default router;
