import express from 'express';
import * as googleAuth from '../services/googleAuth.js';

const router = express.Router();

const { getAuthUrl, getTokens } = googleAuth;

// In-memory token store for now (per-process, non-persistent)
let calendarTokens = null;

// GET /calendar/auth/google (mounted under /calendar -> /calendar/auth/google)
// Redirects the user to Google's OAuth2 consent screen for Calendar access
router.get('/auth/google', (req, res) => {
  try {
    const url = getAuthUrl();
    return res.redirect(url);
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to initiate Google Calendar authentication',
      error: error.message,
    });
  }
});

// GET /calendar/auth/google/callback (mounted under /calendar)
// Handles Google's OAuth2 callback, exchanges code for tokens, and stores them in memory
router.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ message: 'Missing authorization code' });
  }

  try {
    const tokens = await getTokens(code);
    calendarTokens = tokens;

    return res.json({ message: 'Google Calendar Connected' });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to connect Google Calendar',
      error: error.message,
    });
  }
});

// Optional export of tokens getter if other modules need access
export function getStoredCalendarTokens() {
  return calendarTokens;
}

export default router;
