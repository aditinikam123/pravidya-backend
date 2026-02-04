import { verifyToken } from '../utils/jwt.js';
import { prisma } from '../prisma/client.js';

/**
 * Authentication Middleware
 * Verifies JWT token and attaches user to request object
 */
export const authenticate = async (req, res, next) => {
  try {
    // Get token from header
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

    // Verify token
    const decoded = verifyToken(token);
    
    // Find user and include counselor profile if exists
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        counselorProfile: true
      }
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

    // Verify role matches token
    if (decoded.role !== user.role) {
      return res.status(401).json({
        success: false,
        message: 'Token role mismatch. Please login again.'
      });
    }

    // Remove password from user object
    const { password, ...userWithoutPassword } = user;

    // Attach user to request
    req.user = userWithoutPassword;
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
