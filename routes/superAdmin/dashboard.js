import express from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { prisma } from '../../prisma/client.js';
import { isPlatformScope } from '../../utils/institutionIds.js';

const router = express.Router();

const isPlatformSuperAdmin = (req) => isPlatformScope(req.superAdmin?.institution);

// @route   GET /api/super-admin/dashboard
// @desc    Dashboard overview - institutions, staff, leads (scoped by institution)
// @access  Private (Super Admin)
router.get('/', asyncHandler(async (req, res) => {
  const instId = req.institutionId;
  const platform = isPlatformSuperAdmin(req);

  const instWhere = platform ? {} : { institutionId: instId };
  const leadWhere = platform ? {} : { institutionId: instId };

  const [
    institutionsCount,
    staffCount,
    adminCount,
    counselorCount,
    managementCount,
    leadsCount,
    enrolledCount,
  ] = await Promise.all([
    platform ? prisma.institution.count() : 1,
    prisma.user.count({
      where: platform ? { institutionId: { not: null } } : instWhere,
    }),
    prisma.user.count({ where: { ...instWhere, role: 'ADMIN' } }),
    prisma.user.count({ where: { ...instWhere, role: 'COUNSELOR' } }),
    prisma.user.count({ where: { ...instWhere, role: 'MANAGEMENT' } }),
    prisma.lead.count({ where: leadWhere }),
    prisma.lead.count({ where: { ...leadWhere, status: 'ENROLLED' } }),
  ]);

  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const newLeadsToday = await prisma.lead.count({
    where: { ...leadWhere, submittedAt: { gte: oneDayAgo } },
  });

  res.json({
    success: true,
    data: {
      overview: {
        institutions: institutionsCount,
        staff: staffCount,
        admins: adminCount,
        counselors: counselorCount,
        management: managementCount,
        leads: leadsCount,
        enrolled: enrolledCount,
        newLeadsToday,
      },
      institutionId: instId,
      isPlatform: platform,
    },
  });
}));

export default router;
