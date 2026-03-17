import jwt from 'jsonwebtoken';
import { verifyToken } from '../utils/jwt.js';
import { verifySuperAdminToken } from '../utils/superAdminJwt.js';
import { prisma } from '../prisma/client.js';

const PRAVIDYA_SECRET = process.env.PRAVIDYA_JWT_SECRET || process.env.JWT_SECRET;

/**
 * Authenticate Super Admin - validates Super Admin JWT only.
 * Sets req.superAdmin, req.user (compat shape), req.institutionId.
 */
export const authenticateSuperAdmin = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.replace('Bearer ', '')
      : authHeader;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided. Access denied.',
      });
    }

    let decoded;
    try {
      decoded = verifySuperAdminToken(token);
    } catch {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token.',
      });
    }

    if (decoded.role !== 'SUPER_ADMIN' || !decoded.superAdminId || !decoded.institutionId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Super Admin token.',
      });
    }

    const superAdmin = await prisma.superAdmin.findUnique({
      where: { id: decoded.superAdminId },
      include: { institution: true },
    });

    if (!superAdmin || !superAdmin.isActive || superAdmin.institutionId !== decoded.institutionId) {
      return res.status(401).json({
        success: false,
        message: 'User not found or inactive. Token invalid.',
      });
    }

    req.superAdmin = superAdmin;
    req.superAdminId = superAdmin.id;
    req.institutionId = superAdmin.institutionId;
    req.user = {
      id: superAdmin.id,
      email: superAdmin.email,
      fullName: superAdmin.fullName ?? undefined,
      role: 'SUPER_ADMIN',
      institutionId: superAdmin.institutionId,
      institutionName: superAdmin.institution?.name,
      jitofyInstitutionId: superAdmin.institution?.jitofyInstitutionId,
      isSuperAdmin: true,
    };
    req.userRole = 'SUPER_ADMIN';
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || 'Invalid or expired token.',
    });
  }
};
