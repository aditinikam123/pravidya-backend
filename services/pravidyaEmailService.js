import nodemailer from 'nodemailer';

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.warn('[pravidyaEmailService] SMTP not configured. Email sending disabled.');
    return null;
  }

  transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  return transporter;
};

export const sendOtpEmail = async (toEmail, otp, academyName = 'Academy') => {
  const trans = getTransporter();
  if (!trans) {
    console.warn('[sendOtpEmail] Transporter not configured, skipping');
    return { success: false, skipped: true };
  }

  try {
    await trans.sendMail({
      from: process.env.SMTP_FROM || process.env.GMAIL_USER,
      to: toEmail,
      subject: `Your login verification code - ${academyName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto;">
          <h2>Verification Code</h2>
          <p>Your one-time verification code for ${academyName} is:</p>
          <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #2563eb;">${otp}</p>
          <p style="color: #666; font-size: 14px;">This code expires in 5 minutes. Do not share it with anyone.</p>
        </div>
      `,
      text: `Your verification code for ${academyName} is: ${otp}. It expires in 5 minutes.`,
    });
    return { success: true };
  } catch (err) {
    console.error('[sendOtpEmail]', err);
    throw new Error('Failed to send verification email.');
  }
};

export const sendPasswordResetEmail = async (toEmail, resetLink, academyName = 'Academy') => {
  const trans = getTransporter();
  if (!trans) {
    console.warn('[sendPasswordResetEmail] Transporter not configured, skipping');
    return { success: false, skipped: true };
  }

  try {
    await trans.sendMail({
      from: process.env.SMTP_FROM || process.env.GMAIL_USER,
      to: toEmail,
      subject: `Password Reset - ${academyName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>You requested a password reset for your ${academyName} account.</p>
          <p><a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px;">Reset Password</a></p>
          <p style="color: #666; font-size: 14px;">This link expires in 15 minutes. If you did not request this, please ignore.</p>
        </div>
      `,
      text: `Reset your password: ${resetLink}. This link expires in 15 minutes.`,
    });
    return { success: true };
  } catch (err) {
    console.error('[sendPasswordResetEmail]', err);
    throw new Error('Failed to send password reset email.');
  }
};
