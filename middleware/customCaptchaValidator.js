import { validateCaptcha } from '../services/captcha/captchaStore.js';

/**
 * Validate custom image captcha from request body
 * Expects: captchaId, captchaText
 */
export const validateCustomCaptcha = (req, res, next) => {
  const { captchaId, captchaText } = req.body;
  const result = validateCaptcha(captchaId, captchaText);

  if (!result.valid) {
    return res.status(400).json({
      success: false,
      message: result.error || 'Invalid captcha',
    });
  }
  next();
};
