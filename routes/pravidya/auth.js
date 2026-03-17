import express from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { prisma } from '../../prismaClient.js';
import { pravdiyaLoginLimiter } from '../../middleware/pravidyaRateLimiter.js';
import { validateCustomCaptcha } from '../../middleware/customCaptchaValidator.js';
import { authenticatePravidya, COOKIE_NAME } from '../../middleware/pravidyaAuth.js';
import { generatePravidyaToken } from '../../utils/pravidyaJwt.js';
import { generateToken } from '../../utils/jwt.js';
import { hashPassword } from '../../utils/password.js';
import { generateOtp, getOtpExpiry, isOtpExpired } from '../../services/pravidyaOtpService.js';
import { sendOtpEmail, sendPasswordResetEmail } from '../../services/pravidyaEmailService.js';

const router = express.Router();

/** URL slug "veman" (one e) maps to DB slug "veeman" (two e's). */
const normalizeAcademySlug = (s) => {
  const slug = (s || '').toLowerCase().trim();
  return slug === 'veman' ? 'veeman' : slug;
};

const LOCK_DURATION_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 5;
const PASSWORD_MAX_AGE_DAYS = 90;

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  body('role').isIn(['ADMIN', 'COUNSELOR', 'MANAGEMENT']).withMessage('Valid role is required'),
  body('academySlug').trim().notEmpty().withMessage('Academy slug is required'),
  body('captchaId').notEmpty().withMessage('Captcha is required'),
  body('captchaText').notEmpty().withMessage('Captcha is required'),
];

router.post(
  '/login',
  pravdiyaLoginLimiter,
  validateCustomCaptcha,
  validateLogin,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { email, password, role, academySlug } = req.body;
    const academy = await prisma.academy.findUnique({
      where: { slug: normalizeAcademySlug(academySlug) },
    });

    if (!academy) {
      return res.status(404).json({ success: false, message: 'Academy not found' });
    }

    const emailNorm = email.toLowerCase().trim();
    const user = await prisma.academyUser.findUnique({
      where: {
        academyId_email: { academyId: academy.id, email: emailNorm },
      },
    });

    if (!user || user.role !== role) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[PRAVIDYA] Invalid credentials: no academy user for', { email: emailNorm, academySlug, role });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        ...(process.env.NODE_ENV !== 'production' && {
          hint: 'No user for this email/academy/role. Run: node scripts/seedPravidyaAcademy.js',
        }),
      });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(423).json({
        success: false,
        message: `Account locked. Try again after ${user.lockedUntil.toISOString()}`,
      });
    }

    let isValid = await bcrypt.compare(password, user.passwordHash);
    // Dev-only: if password wrong, set DB to what they typed so next attempt works
    if (!isValid && process.env.NODE_ENV !== 'production') {
      const newHash = await hashPassword(password);
      await prisma.academyUser.update({
        where: { id: user.id },
        data: { passwordHash: newHash, failedAttempts: 0, lockedUntil: null },
      });
      console.log('[PRAVIDYA] Dev: password updated to what you entered. Try logging in again.');
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. In development we’ve set your password to what you just entered — try again.',
      });
    }
    if (!isValid) {
      const failed = (user.failedAttempts || 0) + 1;
      const updates = { failedAttempts: failed };
      if (failed >= MAX_FAILED_ATTEMPTS) {
        const lockedUntil = new Date();
        lockedUntil.setMinutes(lockedUntil.getMinutes() + LOCK_DURATION_MINUTES);
        updates.lockedUntil = lockedUntil;
      }
      await prisma.academyUser.update({ where: { id: user.id }, data: updates });
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const otp = generateOtp();
    const otpExpiry = getOtpExpiry();
    console.log(`[PRAVIDYA] OTP for ${user.email}: ${otp} (dev: copy to login)`);

    await prisma.academyUser.update({
      where: { id: user.id },
      data: { otpCode: otp, otpExpiry, failedAttempts: 0, lockedUntil: null },
    });

    await sendOtpEmail(user.email, otp, academy.name);

    res.json({
      success: true,
      message: process.env.NODE_ENV !== 'production' ? 'OTP Sent (check backend console)' : 'OTP Sent',
      data: { email: user.email },
    });
  })
);

// Resend OTP (no password) - only valid after previous OTP has expired
const validateResendOtp = [
  body('email').isEmail().normalizeEmail(),
  body('academySlug').trim().notEmpty(),
  body('role').isIn(['ADMIN', 'COUNSELOR', 'MANAGEMENT']),
];

router.post(
  '/resend-otp',
  pravdiyaLoginLimiter,
  validateResendOtp,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { email, academySlug, role } = req.body;
    const academy = await prisma.academy.findUnique({
      where: { slug: normalizeAcademySlug(academySlug) },
    });
    if (!academy) {
      return res.status(404).json({ success: false, message: 'Academy not found' });
    }

    const emailNorm = email.toLowerCase().trim();
    const user = await prisma.academyUser.findUnique({
      where: { academyId_email: { academyId: academy.id, email: emailNorm } },
    });
    if (!user || user.role !== role) {
      return res.status(401).json({ success: false, message: 'Invalid request' });
    }

    // Only allow resend if current OTP is expired (or not set)
    if (user.otpExpiry && !isOtpExpired(user.otpExpiry)) {
      return res.status(400).json({
        success: false,
        message: 'Current code is still valid. Use it or wait for it to expire.',
      });
    }

    const otp = generateOtp();
    const otpExpiry = getOtpExpiry();
    await prisma.academyUser.update({
      where: { id: user.id },
      data: { otpCode: otp, otpExpiry, failedAttempts: 0, lockedUntil: null },
    });
    await sendOtpEmail(user.email, otp, academy.name);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[PRAVIDYA] Resend OTP for ${user.email}: ${otp}`);
    }

    res.json({
      success: true,
      message: 'New verification code sent to your email.',
      data: { otpExpiresAt: otpExpiry.toISOString() },
    });
  })
);

const validateVerifyOtp = [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric(),
  body('academySlug').trim().notEmpty(),
  body('role').isIn(['ADMIN', 'COUNSELOR', 'MANAGEMENT']),
];

router.post(
  '/verify-otp',
  validateVerifyOtp,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { email, otp, academySlug, role } = req.body;
    const academy = await prisma.academy.findUnique({
      where: { slug: normalizeAcademySlug(academySlug) },
    });

    if (!academy) {
      return res.status(404).json({ success: false, message: 'Academy not found' });
    }

    const user = await prisma.academyUser.findUnique({
      where: {
        academyId_email: { academyId: academy.id, email: email.toLowerCase() },
      },
    });

    if (!user || user.role !== role) {
      return res.status(401).json({ success: false, message: 'Invalid OTP' });
    }

    if (isOtpExpired(user.otpExpiry)) {
      await prisma.academyUser.update({ where: { id: user.id }, data: { otpCode: null, otpExpiry: null } });
      return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
    }

    if (user.otpCode !== otp) {
      return res.status(401).json({ success: false, message: 'Invalid OTP' });
    }

    const passwordMaxAge = new Date();
    passwordMaxAge.setDate(passwordMaxAge.getDate() - PASSWORD_MAX_AGE_DAYS);
    if (user.passwordLastChanged < passwordMaxAge) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenExpiry = new Date();
      resetTokenExpiry.setMinutes(resetTokenExpiry.getMinutes() + 15);
      await prisma.academyUser.update({
        where: { id: user.id },
        data: { otpCode: null, otpExpiry: null, resetToken, resetTokenExpiry },
      });
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const resetLink = `${baseUrl}/pravidya/${academy.domain || 'acme'}/${academy.slug}/reset-password?token=${resetToken}`;
      await sendPasswordResetEmail(user.email, resetLink, academy.name);
      return res.json({
        success: true,
        requiresPasswordReset: true,
        message: 'Password has expired. Check your email for a reset link.',
        data: { email: user.email, academySlug: academy.slug },
      });
    }

    await prisma.academyUser.update({
      where: { id: user.id },
      data: { otpCode: null, otpExpiry: null, isVerified: true },
    });

    const pravidyaToken = generatePravidyaToken(user.id, user.academyId, user.role);

    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(COOKIE_NAME, pravidyaToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'strict' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    const mainUser = await prisma.user.findUnique({
      where: { email: user.email },
      include: { counselorProfile: true },
    });

    const responseData = {
      user: {
        id: mainUser?.id || user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName ?? undefined,
        academyId: user.academyId,
        academyName: academy.name,
        academySlug: academy.slug,
        isAdmin: user.role === 'ADMIN',
        isCounselor: user.role === 'COUNSELOR',
        isManagement: user.role === 'MANAGEMENT',
      },
    };

    if (mainUser) {
      responseData.token = generateToken(mainUser.id, mainUser.role);
    } else {
      // Academy-only user: return Pravidya token so frontend can store and use it for /api/auth/me
      responseData.token = pravidyaToken;
    }

    res.json({ success: true, message: 'Login successful', data: responseData });
  })
);

router.get('/me', authenticatePravidya, asyncHandler(async (req, res) => {
  const user = req.academyUser;
  const academy = user.academy;
  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName ?? undefined,
        academyId: user.academyId,
        academyName: academy.name,
        academySlug: academy.slug,
      },
    },
  });
}));

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ success: true, message: 'Logged out' });
});

const validateForgotPassword = [
  body('email').isEmail().normalizeEmail(),
  body('academySlug').trim().notEmpty(),
];

router.post(
  '/forgot-password',
  pravdiyaLoginLimiter,
  validateForgotPassword,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { email, academySlug } = req.body;
    const academy = await prisma.academy.findUnique({
      where: { slug: normalizeAcademySlug(academySlug) },
    });

    if (!academy) {
      return res.status(404).json({ success: false, message: 'Academy not found' });
    }

    const user = await prisma.academyUser.findUnique({
      where: {
        academyId_email: { academyId: academy.id, email: email.toLowerCase() },
      },
    });

    if (!user) {
      return res.json({ success: true, message: 'If an account exists, you will receive a password reset link.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date();
    resetTokenExpiry.setMinutes(resetTokenExpiry.getMinutes() + 15);

    await prisma.academyUser.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetLink = `${baseUrl}/pravidya/${academy.domain || 'acme'}/${academy.slug}/reset-password?token=${resetToken}`;
    await sendPasswordResetEmail(user.email, resetLink, academy.name);

    res.json({ success: true, message: 'If an account exists, you will receive a password reset link.' });
  })
);

const passwordSchema = (value) => {
  if (value.length < 8) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  return true;
};

const validateResetPassword = [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password').custom(passwordSchema).withMessage('Password must be 8+ chars, 1 uppercase, 1 number'),
  body('academySlug').trim().notEmpty(),
];

router.post(
  '/reset-password',
  validateResetPassword,
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { token, password, academySlug } = req.body;
    const academy = await prisma.academy.findUnique({
      where: { slug: normalizeAcademySlug(academySlug) },
    });

    if (!academy) {
      return res.status(404).json({ success: false, message: 'Academy not found' });
    }

    const user = await prisma.academyUser.findFirst({
      where: { resetToken: token, academyId: academy.id },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    if (!user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      await prisma.academyUser.update({ where: { id: user.id }, data: { resetToken: null, resetTokenExpiry: null } });
      return res.status(400).json({ success: false, message: 'Reset token has expired. Please request a new one.' });
    }

    const passwordHash = await hashPassword(password);
    await prisma.academyUser.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordLastChanged: new Date(),
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    res.json({ success: true, message: 'Password reset successful. You can now login.' });
  })
);

export default router;
