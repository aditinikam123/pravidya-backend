import jwt from 'jsonwebtoken';
import { prisma } from '../prismaClient.js';

const JWT_SECRET = process.env.JWT_SECRET || process.env.PRAVIDYA_JWT_SECRET;
const COOKIE_NAME = 'pravidya_token';

export const authenticatePravidya = async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login.',
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded.userId || !decoded.academyId || !decoded.role) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload. Please login again.',
      });
    }

    const user = await prisma.academyUser.findUnique({
      where: { id: decoded.userId },
      include: { academy: true },
    });

    if (!user || user.academyId !== decoded.academyId) {
      return res.status(401).json({
        success: false,
        message: 'User not found or academy mismatch.',
      });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(423).json({
        success: false,
        message: `Account locked until ${user.lockedUntil.toISOString()}.`,
      });
    }

    req.academyUser = user;
    req.academyUserId = user.id;
    req.academyId = user.academyId;
    req.academyRole = user.role;

    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: err.name === 'TokenExpiredError' ? 'Session expired. Please login again.' : 'Invalid token.',
      });
    }
    return res.status(500).json({ success: false, message: 'Authentication error.' });
  }
};

export const authorizePravidya = (...roles) => {
  return (req, res, next) => {
    if (!req.academyUser) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (!roles.flat().includes(req.academyRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}.`,
      });
    }
    next();
  };
};

export { COOKIE_NAME };
