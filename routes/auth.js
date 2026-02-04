import express from 'express';
import { body, validationResult } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { generateToken } from '../utils/jwt.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { prisma } from '../prisma/client.js';
import * as presenceService from '../services/presenceTracking.js';

const router = express.Router();

// @route   POST /api/auth/login
// @desc    Login user (Admin or Counselor)
// @access  Public
router.post('/login', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { username, password } = req.body;

  // Find user by username or email
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username },
        { email: username }
      ]
    },
    include: {
      counselorProfile: true
    }
  });

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials'
    });
  }

  if (!user.isActive) {
    return res.status(401).json({
      success: false,
      message: 'Account is inactive. Please contact administrator.'
    });
  }

  const isPasswordValid = await comparePassword(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials'
    });
  }

  const token = generateToken(user.id, user.role);

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: 'LOGIN',
      entityType: 'USER',
      entityId: user.id,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    }
  });

  // Record presence for counselors
  if (user.role === 'COUNSELOR' && user.counselorProfile) {
    try {
      await presenceService.recordLogin(user.counselorProfile.id);
    } catch (error) {
      console.error('❌ Error recording counselor login:', error);
      // Don't fail the login if presence tracking fails
      // Log the error but continue with successful login
    }
  }

  const { password: _, ...userWithoutPassword } = user;

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      token,
      user: {
        ...userWithoutPassword,
        isAdmin: user.role === 'ADMIN',
        isCounselor: user.role === 'COUNSELOR',
        isManagement: user.role === 'MANAGEMENT'
      }
    }
  });
}));

// @route   POST /api/auth/admin/login
// @desc    Admin login (explicit admin-only endpoint)
// @access  Public
router.post('/admin/login', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { username, password } = req.body;

  // Find user by username or email with ADMIN role
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username },
        { email: username }
      ],
      role: 'ADMIN' // Explicitly check for ADMIN role
    }
  });

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Invalid admin credentials'
    });
  }

  if (!user.isActive) {
    return res.status(401).json({
      success: false,
      message: 'Admin account is inactive. Please contact system administrator.'
    });
  }

  const isPasswordValid = await comparePassword(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({
      success: false,
      message: 'Invalid admin credentials'
    });
  }

  const token = generateToken(user.id, user.role);

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: 'ADMIN_LOGIN',
      entityType: 'USER',
      entityId: user.id,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    }
  });

  const { password: _, ...userWithoutPassword } = user;

  res.json({
    success: true,
    message: 'Admin login successful',
    data: {
      token,
      user: {
        ...userWithoutPassword,
        isAdmin: true,
        isCounselor: false,
        isManagement: user.role === 'MANAGEMENT'
      }
    }
  });
}));

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    include: {
      counselorProfile: true
    }
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  const { password: _, ...userWithoutPassword } = user;

  res.json({
    success: true,
    data: {
      user: {
        ...userWithoutPassword,
        isAdmin: user.role === 'ADMIN',
        isCounselor: user.role === 'COUNSELOR'
      }
    }
  });
}));

// @route   GET /api/auth/admin/me
// @desc    Get current admin user (admin-only)
// @access  Private (Admin)
router.get('/admin/me', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId }
  });

  if (!user || user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.'
    });
  }

  const { password: _, ...userWithoutPassword } = user;

  res.json({
    success: true,
    message: 'Admin profile retrieved successfully',
    data: {
      user: {
        ...userWithoutPassword,
        isAdmin: true
      }
    }
  });
}));

// @route   POST /api/auth/change-password
// @desc    Change password
// @access  Private
router.post('/change-password', authenticate, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { currentPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({
    where: { id: req.userId }
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  const isPasswordValid = await comparePassword(currentPassword, user.password);
  if (!isPasswordValid) {
    return res.status(400).json({
      success: false,
      message: 'Current password is incorrect'
    });
  }

  const hashedPassword = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: req.userId },
    data: { password: hashedPassword }
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: 'PASSWORD_CHANGE',
      entityType: 'USER',
      entityId: user.id
    }
  });

  res.json({
    success: true,
    message: 'Password changed successfully'
  });
}));

export default router;
