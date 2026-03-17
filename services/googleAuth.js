import { google } from 'googleapis';

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  throw new Error(
    'Missing Google OAuth environment variables. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.'
  );
}

// Scopes required for Google Calendar access
export const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Shared OAuth2 client instance
export const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

/**
 * Generate a Google OAuth2 consent screen URL for Calendar access.
 * Optionally accepts a state string for CSRF protection or custom data.
 */
export function getAuthUrl(state) {
  const options = {
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  };

  if (state) {
    options.state = state;
  }

  return oauth2Client.generateAuthUrl(options);
}

/**
 * Exchange an authorization code for tokens and set them on the shared client.
 */
export async function getTokens(code) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  return tokens;
}

/**
 * Get a Calendar API client, optionally using per-user tokens.
 * If tokens are provided, a new OAuth2 client is created for isolation.
 */
export function getCalendarClient(tokens) {
  let client = oauth2Client;

  if (tokens) {
    client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
    client.setCredentials(tokens);
  }

  return google.calendar({ version: 'v3', auth: client });
}

