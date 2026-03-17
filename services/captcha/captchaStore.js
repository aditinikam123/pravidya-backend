import crypto from 'crypto';

const CAPTCHA_EXPIRY_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const CLEANUP_INTERVAL_MS = 60 * 1000;

const store = new Map();

const hashText = (text) => crypto.createHash('sha256').update((text || '').toLowerCase().trim()).digest('hex');

export const createCaptcha = (hashedValue) => {
  const captchaId = crypto.randomUUID();
  store.set(captchaId, {
    hashedValue,
    expiresAt: Date.now() + CAPTCHA_EXPIRY_MS,
    attempts: 0,
  });
  return captchaId;
};

export const validateCaptcha = (captchaId, captchaText) => {
  if (!captchaId || !captchaText) {
    return { valid: false, error: 'Captcha is required' };
  }

  const entry = store.get(captchaId);
  if (!entry) {
    return { valid: false, error: 'Invalid or expired captcha. Please refresh.' };
  }

  if (Date.now() > entry.expiresAt) {
    store.delete(captchaId);
    return { valid: false, error: 'Captcha expired. Please refresh.' };
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    store.delete(captchaId);
    return { valid: false, error: 'Too many attempts. Please refresh captcha.' };
  }

  const inputHash = hashText(captchaText);
  if (inputHash !== entry.hashedValue) {
    entry.attempts += 1;
    return { valid: false, error: `Invalid captcha. ${MAX_ATTEMPTS - entry.attempts} attempts remaining.` };
  }

  store.delete(captchaId);
  return { valid: true };
};

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(id);
  }
}, CLEANUP_INTERVAL_MS);

export { hashText };
