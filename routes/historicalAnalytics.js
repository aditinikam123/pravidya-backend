/**
 * Historical Admissions Analytics - shared endpoint for Admin, Management, Counselor
 * Role-based: Admin (all), Management (overall), Counselor (own institution only)
 */
import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { prisma } from '../prisma/client.js';

const router = express.Router();

async function computeHistoricalAnalytics(params, req) {
  let { institutionId, academicYear, category } = params;

  if (req.userRole === 'COUNSELOR') {
    const instId = req.user?.counselorProfile?.institutionId;
    if (!instId) {
      throw Object.assign(new Error('Counselor has no institution assigned'), { statusCode: 403 });
    }
    institutionId = instId;
  }
  if (req.userRole === 'MANAGEMENT') {
    institutionId = null;
  }

  const baseFileWhere = { institutionId: { not: null } };
  if (institutionId) baseFileWhere.institutionId = institutionId;
  if (academicYear) baseFileWhere.academicYear = academicYear;
  if (category) baseFileWhere.category = category;

  const verifiedFileWhere = {
    ...baseFileWhere,
    status: { in: ['VERIFIED', 'LOCKED'] },
    parsedData: { not: null },
  };

  const admWhere = { isPlaceholder: false };
  if (institutionId) admWhere.institutionId = institutionId;
  if (academicYear) admWhere.academicYear = academicYear;
  if (category) admWhere.category = category;
  const verifiedAdmWhere = { ...admWhere, status: { in: ['VERIFIED', 'LOCKED'] } };

  const files = await prisma.historicalFile.findMany({
    where: verifiedFileWhere,
    select: { id: true, institutionId: true, category: true, parsedData: true, institution: { select: { name: true } } },
  });

  const instGroupWhere = { status: { in: ['VERIFIED', 'LOCKED'] }, institutionId: { not: null } };
  if (institutionId) instGroupWhere.institutionId = institutionId;

  const [institutionGroups, totalFiles, pendingFiles, verifiedFiles, verifiedAdmCount, admByStatus] = await Promise.all([
    prisma.historicalFile.groupBy({ by: ['institutionId'], where: instGroupWhere }),
    prisma.historicalFile.count({ where: baseFileWhere }),
    prisma.historicalFile.count({ where: { ...baseFileWhere, status: 'PENDING' } }),
    prisma.historicalFile.count({ where: { ...baseFileWhere, status: { in: ['VERIFIED', 'LOCKED'] } } }),
    prisma.historicalAdmission.count({ where: verifiedAdmWhere }),
    prisma.historicalAdmission.groupBy({ by: ['status'], where: admWhere, _count: { id: true } }),
  ]);
  const institutionCount = institutionGroups.length;

  const yearTrend = {};
  const institutionAdmissions = {};
  const categoryCount = { Marketing: 0, Publicity: 0, Both: 0 };
  let totalAdmissionRows = 0;

  files.forEach((f) => {
    categoryCount[f.category] = (categoryCount[f.category] || 0) + 1;
    const instName = f.institution?.name || 'Unknown';
    const data = f.parsedData;
    if (Array.isArray(data)) {
      data.forEach((row) => {
        const y = row.Year ?? row.year ?? row.col_1;
        const adm = row.Admissions ?? row.admissions ?? row.col_3;
        const n = parseInt(adm, 10) || 0;
        if (y) {
          const yStr = String(y).slice(0, 4);
          if (!academicYear || yStr === academicYear || String(academicYear).includes(yStr)) {
            yearTrend[yStr] = (yearTrend[yStr] || 0) + n;
            institutionAdmissions[instName] = (institutionAdmissions[instName] || 0) + n;
            totalAdmissionRows += n;
          }
        }
      });
    }
  });

  const admStatusCounts = {};
  (admByStatus || []).forEach((g) => { admStatusCounts[g.status] = g._count.id; });
  const verifiedAdm = (admStatusCounts.VERIFIED || 0) + (admStatusCounts.LOCKED || 0);
  const pendingAdm = (admStatusCounts.DRAFT || 0) + (admStatusCounts.SUBMITTED || 0);

  const totalHistoricalRecords = totalAdmissionRows + verifiedAdmCount;

  const yearWiseAdmissions = Object.entries(yearTrend)
    .map(([year, admissions]) => ({ year, admissions }))
    .sort((a, b) => a.year.localeCompare(b.year));

  const institutionWise = Object.entries(institutionAdmissions)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const categoryDistribution = Object.entries(categoryCount)
    .filter(([, c]) => c > 0)
    .map(([name, count]) => ({ name, count }));

  return {
    totalInstitutions: institutionCount,
    totalHistoricalRecords,
    totalFiles,
    verifiedRecords: verifiedFiles + verifiedAdm,
    pendingRecords: pendingFiles + pendingAdm,
    yearWiseAdmissions,
    institutionWise,
    categoryDistribution,
    verifiedVsPending: [
      { name: 'Verified', count: verifiedFiles + verifiedAdm, fill: '#10B981' },
      { name: 'Pending', count: pendingFiles + pendingAdm, fill: '#F59E0B' },
    ],
  };
}

router.get(
  '/',
  authenticate,
  authorize('ADMIN', 'MANAGEMENT', 'COUNSELOR'),
  asyncHandler(async (req, res) => {
    if (req.userRole === 'COUNSELOR') {
      const profile = await prisma.counselorProfile.findFirst({
        where: { userId: req.userId },
        select: { institutionId: true },
      });
      if (!profile?.institutionId) {
        return res.status(403).json({
          success: false,
          message: 'Counselor has no institution assigned. Contact administrator.',
        });
      }
    }

    const { institutionId, academicYear, category } = req.query;
    const params = { institutionId: institutionId || null, academicYear: academicYear || null, category: category || null };

    const data = await computeHistoricalAnalytics(params, req);
    res.json({ success: true, data });
  })
);

export default router;
