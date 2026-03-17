/**
 * Counselor Google Meet link: save/retrieve static link + OAuth flow to generate via Google Calendar.
 * Uses GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI from .env.
 * POST /save-meet-link, GET /meet-link/:counselorId
 * GET /google-meet-auth-url (auth), GET /calendar/callback (OAuth callback, no auth)
 */
import express from 'express';
import { body, validationResult } from 'express-validator';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { prisma } from '../prismaClient.js';

const router = express.Router();
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const FRONTEND_SESSIONS_PATH = '/counselor/sessions';

function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  return { clientId, clientSecret, redirectUri };
}

// GET /api/counselor/google-meet-auth-url?counselorId=xxx — OAuth URL for "Generate Meet Link" (uses env credentials)
router.get(
  '/google-meet-auth-url',
  authenticate,
  asyncHandler(async (req, res) => {
    const { counselorId } = req.query;
    if (!counselorId) return res.status(400).json({ success: false, message: 'counselorId is required' });
    if (req.user.role === 'COUNSELOR') {
      const profile = await prisma.counselorProfile.findFirst({ where: { userId: req.userId } });
      if (!profile || profile.id !== counselorId) return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const { clientId, redirectUri } = getGoogleConfig();
    if (!clientId || !redirectUri) {
      return res.status(503).json({
        success: false,
        message: 'Google Meet not configured. Set GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI in backend .env.',
      });
    }
    const state = String(counselorId).trim();
    const url = [
      'https://accounts.google.com/o/oauth2/v2/auth',
      `?client_id=${encodeURIComponent(clientId)}`,
      `&redirect_uri=${encodeURIComponent(redirectUri)}`,
      '&response_type=code',
      `&scope=${encodeURIComponent(CALENDAR_SCOPE)}`,
      `&state=${encodeURIComponent(state)}`,
      '&access_type=offline',
      '&prompt=consent',
    ].join('');
    res.json({ success: true, data: { url } });
  })
);

// GET /api/counselor/calendar/callback?code=...&state=counselorId — OAuth callback: exchange code, create Meet event, save link, redirect to frontend
router.get(
  '/calendar/callback',
  asyncHandler(async (req, res) => {
    const { code, state: counselorId, error } = req.query;
    const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
    const redirectToFrontend = (params) => {
      const q = new URLSearchParams(params).toString();
      res.redirect(302, `${frontendOrigin}${FRONTEND_SESSIONS_PATH}${q ? `?${q}` : ''}`);
    };
    if (error) {
      redirectToFrontend({ meetError: 'access_denied' });
      return;
    }
    if (!code || !counselorId) {
      redirectToFrontend({ meetError: 'missing_code_or_state' });
      return;
    }
    const { clientId, clientSecret, redirectUri } = getGoogleConfig();
    if (!clientId || !clientSecret || !redirectUri) {
      redirectToFrontend({ meetError: 'server_not_configured' });
      return;
    }
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: String(code).trim(),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[counselor/calendar/callback] token exchange failed:', tokenRes.status, errText);
      redirectToFrontend({ meetError: 'token_exchange_failed' });
      return;
    }
    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;
    if (!accessToken) {
      redirectToFrontend({ meetError: 'no_access_token' });
      return;
    }
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const eventBody = {
      summary: 'Counseling Session',
      start: { dateTime: start.toISOString(), timeZone: 'UTC' },
      end: { dateTime: end.toISOString(), timeZone: 'UTC' },
      conferenceData: {
        createRequest: {
          requestId: `counselor-${counselorId}-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };
    const calendarRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      }
    );
    if (!calendarRes.ok) {
      const errText = await calendarRes.text();
      console.error('[counselor/calendar/callback] calendar insert failed:', calendarRes.status, errText);
      redirectToFrontend({ meetError: 'calendar_failed' });
      return;
    }
    const event = await calendarRes.json();
    const meetLink =
      event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ||
      event.conferenceData?.entryPoints?.[0]?.uri ||
      event.hangoutLink ||
      null;
    if (!meetLink) {
      redirectToFrontend({ meetError: 'no_meet_link' });
      return;
    }
    const counselor = await prisma.counselorProfile.findUnique({ where: { id: String(counselorId).trim() } });
    if (counselor) {
      await prisma.counselorProfile.update({
        where: { id: counselor.id },
        data: { staticMeetLink: meetLink },
      });
    }
    redirectToFrontend({ meetLink, meetSuccess: '1' });
  })
);

// POST /api/counselor/save-meet-link
router.post(
  '/save-meet-link',
  authenticate,
  body('counselorId').notEmpty().withMessage('counselorId is required'),
  body('meetLink').optional().isString(),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    const { counselorId, meetLink } = req.body;

    if (req.user.role === 'COUNSELOR') {
      const profile = await prisma.counselorProfile.findFirst({ where: { userId: req.userId } });
      if (!profile || profile.id !== counselorId) return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const counselor = await prisma.counselorProfile.findUnique({ where: { id: counselorId } });
    if (!counselor) return res.status(404).json({ success: false, message: 'Counselor not found' });

    const link = meetLink && String(meetLink).trim() ? String(meetLink).trim() : null;
    await prisma.counselorProfile.update({
      where: { id: counselorId },
      data: { staticMeetLink: link },
    });

    res.json({ success: true, data: { staticMeetLink: link } });
  })
);

// GET /api/counselor/meet-link/:counselorId
router.get(
  '/meet-link/:counselorId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { counselorId } = req.params;
    if (req.user.role === 'COUNSELOR') {
      const profile = await prisma.counselorProfile.findFirst({ where: { userId: req.userId } });
      if (!profile || profile.id !== counselorId) return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const counselor = await prisma.counselorProfile.findUnique({
      where: { id: counselorId },
      select: { staticMeetLink: true },
    });
    if (!counselor) return res.status(404).json({ success: false, message: 'Counselor not found' });

    res.json({ success: true, data: { staticMeetLink: counselor.staticMeetLink } });
  })
);

export default router;
