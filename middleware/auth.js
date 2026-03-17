import jwt from 'jsonwebtoken';
import { verifyToken } from '../utils/jwt.js';
import { prisma } from '../prisma/client.js';

const PRAVIDYA_SECRET = process.env.PRAVIDYA_JWT_SECRET || process.env.JWT_SECRET;

/**
 * Authentication Middleware
 * Accepts main app JWT, Pravidya (academy) JWT, or Super Admin JWT.
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.replace('Bearer ', '')
      : authHeader;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided. Access denied.'
      });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      if (!PRAVIDYA_SECRET) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
      }
      try {
        decoded = jwt.verify(token, PRAVIDYA_SECRET);
      } catch (e2) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
      }
    }

    // Super Admin token: has superAdminId, institutionId, role: SUPER_ADMIN
    if (decoded.role === 'SUPER_ADMIN' && decoded.superAdminId != null) {
      const superAdmin = await prisma.superAdmin.findUnique({
        where: { id: decoded.superAdminId },
        include: { institution: true }
      });
      if (!superAdmin || !superAdmin.isActive || superAdmin.institutionId !== decoded.institutionId) {
        return res.status(401).json({
          success: false,
          message: 'User not found. Token invalid.'
        });
      }
      req.superAdmin = superAdmin;
      req.user = {
        id: superAdmin.id,
        email: superAdmin.email,
        fullName: superAdmin.fullName ?? undefined,
        role: 'SUPER_ADMIN',
        institutionId: superAdmin.institutionId,
        institutionName: superAdmin.institution?.name,
        jitofyInstitutionId: superAdmin.institution?.jitofyInstitutionId,
        isSuperAdmin: true
      };
      req.userRole = 'SUPER_ADMIN';
      return next();
    }

    // Pravidya token: has academyId
    if (decoded.academyId != null) {
      const academyUser = await prisma.academyUser.findUnique({
        where: { id: decoded.userId },
        include: { academy: true }
      });
      if (!academyUser || academyUser.academyId !== decoded.academyId) {
        return res.status(401).json({
          success: false,
          message: 'User not found. Token invalid.'
        });
      }
      req.academyUser = academyUser;
      req.userId = academyUser.id;
      req.user = {
        id: academyUser.id,
        email: academyUser.email,
        role: academyUser.role,
        fullName: academyUser.fullName ?? undefined,
        academyId: academyUser.academyId,
        academyName: academyUser.academy?.name,
        academySlug: academyUser.academy?.slug,
        isAdmin: academyUser.role === 'ADMIN',
        isCounselor: academyUser.role === 'COUNSELOR',
        isManagement: academyUser.role === 'MANAGEMENT'
      };
      req.userRole = academyUser.role;
      return next();
    }

    // Main app user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { counselorProfile: true }
    });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Token invalid.'
      });
    }
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is inactive. Please contact administrator.'
      });
    }
    if (decoded.role !== user.role) {
      return res.status(401).json({
        success: false,
        message: 'Token role mismatch. Please login again.'
      });
    }
    const { password, ...userWithoutPassword } = user;
    req.user = {
      ...userWithoutPassword,
      isAdmin: user.role === 'ADMIN',
      isCounselor: user.role === 'COUNSELOR'
    };
    req.userId = user.id;
    req.userRole = user.role;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || 'Invalid or expired token.'
    });
  }
};

/**
 * Authenticate for GET /api/auth/me: accepts either main app JWT or Pravidya (academy) JWT.
 * Sets req.user (and req.userId) so the /me handler can return the same shape for both.
 */
export const authenticateMe = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.replace('Bearer ', '')
      : authHeader;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided. Access denied.'
      });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      if (!PRAVIDYA_SECRET) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
      }
      try {
        decoded = jwt.verify(token, PRAVIDYA_SECRET);
      } catch (e2) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired token.'
        });
      }
    }

    // Super Admin token (same secret; payload has superAdminId, institutionId, role: SUPER_ADMIN)
    if (decoded.role === 'SUPER_ADMIN' && decoded.superAdminId != null) {
      const superAdmin = await prisma.superAdmin.findUnique({
        where: { id: decoded.superAdminId },
        include: { institution: true }
      });
      if (!superAdmin || !superAdmin.isActive || superAdmin.institutionId !== decoded.institutionId) {
        return res.status(401).json({
          success: false,
          message: 'User not found. Token invalid.'
        });
      }
      req.user = {
        id: superAdmin.id,
        email: superAdmin.email,
        fullName: superAdmin.fullName ?? undefined,
        role: 'SUPER_ADMIN',
        institutionId: superAdmin.institutionId,
        institutionName: superAdmin.institution?.name,
        jitofyInstitutionId: superAdmin.institution?.jitofyInstitutionId,
        isSuperAdmin: true
      };
      return next();
    }

    // Pravidya token has academyId; main app token does not
    if (decoded.academyId != null) {
      const academyUser = await prisma.academyUser.findUnique({
        where: { id: decoded.userId },
        include: { academy: true }
      });
      if (!academyUser || academyUser.academyId !== decoded.academyId) {
        return res.status(401).json({
          success: false,
          message: 'User not found. Token invalid.'
        });
      }
      req.academyUser = academyUser;
      req.userId = academyUser.id;
      req.user = {
        id: academyUser.id,
        email: academyUser.email,
        role: academyUser.role,
        fullName: academyUser.fullName ?? undefined,
        academyId: academyUser.academyId,
        academyName: academyUser.academy?.name,
        academySlug: academyUser.academy?.slug,
        isAdmin: academyUser.role === 'ADMIN',
        isCounselor: academyUser.role === 'COUNSELOR',
        isManagement: academyUser.role === 'MANAGEMENT'
      };
      return next();
    }

    // Main app user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { counselorProfile: true }
    });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Token invalid.'
      });
    }
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is inactive. Please contact administrator.'
      });
    }
    if (decoded.role !== user.role) {
      return res.status(401).json({
        success: false,
        message: 'Token role mismatch. Please login again.'
      });
    }
    const { password, ...userWithoutPassword } = user;
    req.user = {
      ...userWithoutPassword,
      isAdmin: user.role === 'ADMIN',
      isCounselor: user.role === 'COUNSELOR'
    };
    req.userId = user.id;
    req.userRole = user.role;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || 'Invalid or expired token.'
    });
  }
};

/**
 * Authorization Middleware
 * Checks if user has required role(s)
 * @param {...string|string[]} roles - Allowed roles (e.g., 'ADMIN', 'COUNSELOR', ['ADMIN', 'MANAGEMENT'])
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login first.'
      });
    }

    // Flatten roles array (handle both string and array arguments)
    const allowedRoles = roles.flat();
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.user.role}.`
      });
    }

    next();
  };
};

/**
 * Admin-only Middleware
 * Convenience middleware for admin-only routes
 */
export const requireAdmin = [authenticate, authorize('ADMIN')];

/**
 * Counselor-only Middleware
 * Convenience middleware for counselor-only routes
 */
export const requireCounselor = [authenticate, authorize('COUNSELOR')];

/**
 * Admin or Counselor Middleware
 * Allows both admin and counselor access
 */
export const requireAuth = [authenticate, authorize('ADMIN', 'COUNSELOR')];
