import { prisma } from '../prisma/client.js';
import assignmentEngine from './assignmentEngine.js';

const ROUND_ROBIN_ORDER_BY = [{ createdAt: 'asc' }, { id: 'asc' }];

function normalizeStr(s) {
  return String(s || '').trim().toLowerCase();
}

function parsePreferredLanguages(lead) {
  const raw = (lead?.preferredLanguage || 'English').toString().trim();
  if (!raw) return ['english'];
  return raw
    .split(',')
    .map((l) => normalizeStr(l))
    .filter(Boolean);
}

function counselorMatchesLanguage(counselor, preferredLangs) {
  const langs = Array.isArray(counselor?.languages) ? counselor.languages : [];
  if (langs.length === 0) return false;
  return langs.some((cl) => preferredLangs.includes(normalizeStr(cl)));
}

function isCounselorAssignable(c) {
  if (!c) return false;
  if (c.availability !== 'ACTIVE') return false;
  // Presence OFFLINE is treated as not assignable
  if (c.presence?.status === 'OFFLINE') return false;
  // Marked absent today → skip
  if (c.presence?.dailyAttendance?.some((a) => a?.status === 'ABSENT')) return false;
  // Capacity
  if ((c.maxCapacity ?? 0) > 0 && (c.currentLoad ?? 0) >= c.maxCapacity) return false;
  return true;
}

async function getSystemSettingsRow(tx = prisma) {
  const existing = await tx.systemSettings.findFirst({
    select: { id: true, leadAssignmentMode: true, lastRoundRobinIndex: true },
  });
  if (existing) return existing;
  return await tx.systemSettings.create({
    data: { leadAssignmentMode: 'language', lastRoundRobinIndex: -1 },
    select: { id: true, leadAssignmentMode: true, lastRoundRobinIndex: true },
  });
}

export async function getLeadAssignmentMode() {
  const settings = await getSystemSettingsRow();
  return settings?.leadAssignmentMode || 'language';
}

async function getAssignableCounselorsWithPresence() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return await prisma.counselorProfile.findMany({
    include: {
      user: { select: { id: true, email: true, username: true } },
      presence: {
        select: {
          status: true,
          lastActivityAt: true,
          dailyAttendance: {
            where: { date: startOfToday },
            select: { status: true },
          },
        },
      },
    },
    orderBy: ROUND_ROBIN_ORDER_BY,
  });
}

async function languageBasedPick(lead, { excludeCounselorId } = {}) {
  // Reuse existing behavior: language match is mandatory, expertise + load affects score.
  // To support "exclude counselor" for reassignment, we create a filtered lead-like selection path.
  const preferredLangs = parsePreferredLanguages(lead);
  const counselors = await getAssignableCounselorsWithPresence();
  const eligible = counselors
    .filter(isCounselorAssignable)
    .filter((c) => counselorMatchesLanguage(c, preferredLangs))
    .filter((c) => !excludeCounselorId || c.id !== excludeCounselorId);

  if (eligible.length === 0) {
    const langDisplay = (lead.preferredLanguage || 'English').toString().trim();
    return {
      counselor: null,
      autoAssigned: false,
      assignmentReason: `No counselor found with preferred language (${langDisplay}). Please assign manually.`,
      needsManualAssignment: true,
      score: 0,
    };
  }

  // Use assignmentEngine's scoring, but only across eligible counselors.
  // assignmentEngine currently fetches counselors itself, so do a lightweight scoring here that mirrors it.
  const course = lead.courseId
    ? await prisma.course.findUnique({ where: { id: lead.courseId } })
    : null;

  const scored = eligible
    .map((counselor) => {
      let score = 0;
      const reasons = ['Language match'];

      if (course && Array.isArray(counselor.expertise) && counselor.expertise.length > 0) {
        const courseName = normalizeStr(course.name);
        const hasExpertise = counselor.expertise.some((exp) => {
          const e = normalizeStr(exp);
          return e && (courseName.includes(e) || e.includes(courseName));
        });
        if (hasExpertise) {
          score += 40;
          reasons.push('Expertise match');
        }
      }

      const max = counselor.maxCapacity || 50;
      const load = counselor.currentLoad || 0;
      const loadPercentage = max > 0 ? (load / max) * 100 : 0;
      if (loadPercentage < 50) {
        score += 20;
        reasons.push('Low workload');
      } else if (loadPercentage < 80) {
        score += 10;
        reasons.push('Moderate workload');
      }
      if (load === 0) {
        score += 10;
        reasons.push('No current load');
      }

      return { counselor, score, reasons: reasons.join(', '), loadPercentage };
    })
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.loadPercentage - b.loadPercentage));

  const best = scored[0];
  return {
    counselor: best.counselor,
    autoAssigned: true,
    needsManualAssignment: false,
    score: best.score,
    assignmentReason: `Auto-assigned: ${best.reasons} (Score: ${best.score})`,
  };
}

async function roundRobinPick(lead) {
  const preferredLangs = parsePreferredLanguages(lead);
  const all = (await getAssignableCounselorsWithPresence()).filter(isCounselorAssignable);

  // 1) Try strict language match
  let counselors = all.filter((c) => counselorMatchesLanguage(c, preferredLangs));

  // 2) If none match language, fall back to any active counselor (round robin truly global)
  if (counselors.length === 0) {
    counselors = all;
  }

  if (counselors.length === 0) {
    return {
      counselor: null,
      autoAssigned: false,
      assignmentReason: 'Round robin: no active counselor available for assignment. Please assign manually.',
      needsManualAssignment: true,
      score: 0,
    };
  }

  const picked = await prisma.$transaction(async (tx) => {
    const settings = await getSystemSettingsRow(tx);
    const last = settings.lastRoundRobinIndex ?? -1;
    const next = ((last + 1) % counselors.length + counselors.length) % counselors.length;
    await tx.systemSettings.update({
      where: { id: settings.id },
      data: { lastRoundRobinIndex: next },
    });
    return { counselor: counselors[next], nextIndex: next };
  });

  return {
    counselor: picked.counselor,
    autoAssigned: true,
    needsManualAssignment: false,
    score: 0,
    assignmentReason: `Auto-assigned: Round robin (index ${picked.nextIndex + 1}/${counselors.length})`,
  };
}

function buildLeadSkillSignals(lead, course) {
  const raw = [
    lead?.notes,
    lead?.importedCourseName,
    course?.name,
    lead?.boardUniversity,
    lead?.currentClass,
    lead?.academicYear,
  ]
    .filter(Boolean)
    .map((v) => String(v));
  const text = normalizeStr(raw.join(' | '));

  const board = normalizeStr(lead?.boardUniversity);
  const grade = normalizeStr(lead?.currentClass);
  return { text, board, grade };
}

function scoreSkillMatch(counselor, signals) {
  let score = 0;

  const skills = Array.isArray(counselor?.skills) ? counselor.skills : [];
  const expertise = Array.isArray(counselor?.expertise) ? counselor.expertise : [];
  const boards = Array.isArray(counselor?.boards) ? counselor.boards : [];
  const grades = Array.isArray(counselor?.gradesHandled) ? counselor.gradesHandled : [];

  const skillTokens = [...skills, ...expertise].map(normalizeStr).filter(Boolean);
  for (const t of skillTokens) {
    if (t && signals.text.includes(t)) {
      score += 50;
      break;
    }
  }

  if (signals.board) {
    const hasBoard = boards.map(normalizeStr).some((b) => b === signals.board || signals.board.includes(b) || b.includes(signals.board));
    if (hasBoard) score += 30;
  }

  if (signals.grade) {
    const hasGrade = grades.map(normalizeStr).some((g) => g === signals.grade || signals.grade.includes(g) || g.includes(signals.grade));
    if (hasGrade) score += 20;
  }

  return score;
}

async function skillBasedPick(lead) {
  const preferredLangs = parsePreferredLanguages(lead);
  const course = lead.courseId ? await prisma.course.findUnique({ where: { id: lead.courseId } }) : null;
  const signals = buildLeadSkillSignals(lead, course);

  const counselors = (await getAssignableCounselorsWithPresence())
    .filter(isCounselorAssignable)
    .filter((c) => counselorMatchesLanguage(c, preferredLangs));

  if (counselors.length === 0) {
    const langDisplay = (lead.preferredLanguage || 'English').toString().trim();
    return {
      counselor: null,
      autoAssigned: false,
      assignmentReason: `Skill based: no assignable counselor found with preferred language (${langDisplay}). Please assign manually.`,
      needsManualAssignment: true,
      score: 0,
    };
  }

  const scored = counselors
    .map((c) => {
      const skillScore = scoreSkillMatch(c, signals);
      // Add a small load-based tie-breaker (prefer lower load)
      const max = c.maxCapacity || 50;
      const load = c.currentLoad || 0;
      const loadPenalty = max > 0 ? Math.round((load / max) * 10) : 0;
      const score = skillScore - loadPenalty;
      return { counselor: c, skillScore, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const reasonBits = [];
  if (best.skillScore >= 50) reasonBits.push('Skill/expertise match');
  if (best.skillScore >= 30 && signals.board) reasonBits.push('Board match');
  if (best.skillScore >= 20 && signals.grade) reasonBits.push('Grade match');
  if (reasonBits.length === 0) reasonBits.push('Language match (fallback)');

  return {
    counselor: best.counselor,
    autoAssigned: true,
    needsManualAssignment: false,
    score: best.score,
    assignmentReason: `Auto-assigned: Skill based (${reasonBits.join(', ')})`,
  };
}

function pickByWeight(items) {
  const total = items.reduce((sum, it) => sum + (it.weight || 0), 0);
  if (total <= 0) return items[0]?.counselor || null;
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight || 0;
    if (r <= 0) return it.counselor;
  }
  return items[items.length - 1]?.counselor || null;
}

export async function performanceBasedPick(lead) {
  const preferredLangs = parsePreferredLanguages(lead);
  const counselors = (await getAssignableCounselorsWithPresence())
    .filter(isCounselorAssignable)
    .filter((c) => counselorMatchesLanguage(c, preferredLangs));

  if (counselors.length === 0) {
    const langDisplay = (lead.preferredLanguage || 'English').toString().trim();
    return {
      counselor: null,
      autoAssigned: false,
      assignmentReason: `Performance based: no assignable counselor found with preferred language (${langDisplay}). Please assign manually.`,
      needsManualAssignment: true,
      score: 0,
    };
  }

  // Distribution: top1 40%, top2 30%, top3 20%, rest share 10%
  // Score is computed for ranking only; final pick uses this distribution.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const counselorIds = counselors.map((c) => c.id);
  const counselorUserIds = counselors.map((c) => c.userId);

  const [enrolledGroups, leadCalls, todos] = await Promise.all([
    prisma.lead.groupBy({
      by: ['assignedCounselorId'],
      where: {
        assignedCounselorId: { in: counselorIds },
        status: 'ENROLLED',
        updatedAt: { gte: since },
      },
      _count: { id: true },
    }),
    prisma.leadCall.findMany({
      where: { counselorId: { in: counselorIds }, callStartTime: { gte: since } },
      select: { counselorId: true, leadId: true, callStartTime: true },
    }),
    prisma.todo.findMany({
      where: { userId: { in: counselorUserIds }, createdAt: { gte: since } },
      select: { userId: true, status: true },
    }),
  ]);

  const enrolledMap = new Map(enrolledGroups.map((g) => [g.assignedCounselorId, g._count?.id ?? 0]));

  // Response time: compute per counselor avg minutes from lead.submittedAt to first call
  const leadIds = [...new Set(leadCalls.map((lc) => lc.leadId))];
  const leadSubmitted = leadIds.length
    ? await prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, submittedAt: true },
      })
    : [];
  const submittedMap = new Map(leadSubmitted.map((l) => [l.id, l.submittedAt]));

  const firstCallByLeadCounselor = new Map(); // key `${cId}:${leadId}` -> Date
  for (const lc of leadCalls) {
    const key = `${lc.counselorId}:${lc.leadId}`;
    const existing = firstCallByLeadCounselor.get(key);
    if (!existing || lc.callStartTime < existing) firstCallByLeadCounselor.set(key, lc.callStartTime);
  }
  const responseAgg = new Map(); // counselorId -> {sum, count}
  for (const [key, firstCallAt] of firstCallByLeadCounselor.entries()) {
    const [counselorId, leadId] = key.split(':');
    const submittedAt = submittedMap.get(leadId);
    if (!submittedAt) continue;
    const minutes = Math.max(0, (firstCallAt.getTime() - submittedAt.getTime()) / (60 * 1000));
    const cur = responseAgg.get(counselorId) || { sum: 0, count: 0 };
    cur.sum += minutes;
    cur.count += 1;
    responseAgg.set(counselorId, cur);
  }

  const todoAgg = new Map(); // userId -> {total, completed}
  for (const t of todos) {
    const cur = todoAgg.get(t.userId) || { total: 0, completed: 0 };
    cur.total += 1;
    if (t.status === 'COMPLETED') cur.completed += 1;
    todoAgg.set(t.userId, cur);
  }

  const scored = counselors.map((c) => {
    const admissions = enrolledMap.get(c.id) || 0;
    const resp = responseAgg.get(c.id);
    const avgResponseMins = resp && resp.count > 0 ? resp.sum / resp.count : 9999;
    const todo = todoAgg.get(c.userId) || { total: 0, completed: 0 };
    const followUpRate = todo.total > 0 ? todo.completed / todo.total : 0;

    // Score: admissions high is good, response time low is good, follow-up high is good
    const responseScore = avgResponseMins >= 9999 ? 0 : Math.max(0, 100 - Math.min(100, avgResponseMins)); // crude
    const score = admissions * 10 + responseScore * 0.3 + followUpRate * 100 * 0.2;

    return { counselor: c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  const rest = scored.slice(3);

  const weighted = [];
  if (top[0]) weighted.push({ counselor: top[0].counselor, weight: 40 });
  if (top[1]) weighted.push({ counselor: top[1].counselor, weight: 30 });
  if (top[2]) weighted.push({ counselor: top[2].counselor, weight: 20 });
  if (rest.length > 0) {
    const per = 10 / rest.length;
    rest.forEach((it) => weighted.push({ counselor: it.counselor, weight: per }));
  } else if (weighted.length > 0) {
    // If fewer than 4 counselors, distribute remainder to top1.
    const used = weighted.reduce((s, w) => s + w.weight, 0);
    if (used < 100) weighted[0].weight += (100 - used);
  }

  const pick = pickByWeight(weighted);
  if (!pick) {
    return {
      counselor: null,
      autoAssigned: false,
      assignmentReason: 'Performance based: no counselor could be selected. Please assign manually.',
      needsManualAssignment: true,
      score: 0,
    };
  }

  return {
    counselor: pick,
    autoAssigned: true,
    needsManualAssignment: false,
    score: 0,
    assignmentReason: 'Auto-assigned: Performance based distribution',
  };
}

export async function findCounselorForNewLead(lead) {
  const mode = await getLeadAssignmentMode();
  if (mode === 'round_robin') return await roundRobinPick(lead);
  if (mode === 'skill') return await skillBasedPick(lead);
  if (mode === 'performance') return await performanceBasedPick(lead);
  return await assignmentEngine.findBestCounselor(lead); // preserves existing behavior
}

export async function autoAssignNewLead(lead) {
  const result = await findCounselorForNewLead(lead);
  return await assignmentEngine.assignLead(lead, result);
}

// Explicit round-robin helper for fallback flows (e.g. Released Appointments)
export async function findRoundRobinCounselor(lead) {
  return await roundRobinPick(lead);
}

export async function languageBasedReassign(lead, reason) {
  const pick = await languageBasedPick(lead, { excludeCounselorId: lead.assignedCounselorId });
  if (!pick?.counselor?.id) return null;
  const updated = await assignmentEngine.reassignLead(lead, pick.counselor.id, reason, { isAuto: true });
  return { updated, newCounselor: pick.counselor, assignmentReason: pick.assignmentReason };
}

