import express from 'express';
import rateLimit from 'express-rate-limit';
import { generateCaptcha } from '../services/captcha/generateCaptcha.js';
import { createCaptcha, hashText } from '../services/captcha/captchaStore.js';

const router = express.Router();

const captchaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many captcha requests. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /api/auth/captcha
 */
router.get('/captcha', captchaLimiter, (req, res) => {
  try {
    const { text, imageData } = generateCaptcha();
    const hashedValue = hashText(text);
    const captchaId = createCaptcha(hashedValue);

    res.json({
      success: true,
      data: {
        captchaId,
        image: imageData,
      },
    });
  } catch (err) {
    console.error('[captcha]', err);
    res.status(500).json({
      success: false,
      message: 'Failed to generate captcha',
    });
  }
});

export default router;
