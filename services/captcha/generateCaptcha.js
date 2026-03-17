import svgCaptcha from 'svg-captcha';

const WIDTH = 180;
const HEIGHT = 60;
const LENGTH = 6;
const NOISE = 3;

/**
 * Generate random 6-character CAPTCHA
 */
export const generateCaptcha = () => {
  const captcha = svgCaptcha.create({
    size: LENGTH,
    width: WIDTH,
    height: HEIGHT,
    fontSize: 36,
    charPreset: 'abcdefghjkmnpqrstuvwxyz23456789',
    ignoreChars: '0oO1ilI',
    noise: NOISE,
    color: false,
    background: '#f8fafc',
  });

  const svgBase64 = Buffer.from(captcha.data, 'utf8').toString('base64');
  return {
    text: captcha.text.toLowerCase(),
    imageData: `data:image/svg+xml;base64,${svgBase64}`,
  };
};
