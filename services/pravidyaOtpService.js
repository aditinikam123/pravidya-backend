import crypto from 'crypto';

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 5;

export const generateOtp = () => {
  const digits = '0123456789';
  let otp = '';
  const randomBytes = crypto.randomBytes(OTP_LENGTH);
  for (let i = 0; i < OTP_LENGTH; i++) {
    otp += digits[randomBytes[i] % 10];
  }
  return otp;
};

export const getOtpExpiry = () => {
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + OTP_EXPIRY_MINUTES);
  return expiry;
};

export const isOtpExpired = (otpExpiry) => {
  if (!otpExpiry) return true;
  return new Date() > new Date(otpExpiry);
};
