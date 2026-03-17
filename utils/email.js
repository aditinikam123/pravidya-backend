/**
 * Simple email sender. Configure SMTP in .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).
 * For Gmail: use SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, and an App Password (not your normal password).
 */
import nodemailer from 'nodemailer';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = (process.env.SMTP_HOST || '').trim();
  const portRaw = process.env.SMTP_PORT || '587';
  const port = Number(portRaw);
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  if (!host || !user || !pass) return null;
  const isGmail = host.toLowerCase().includes('gmail.com');
  transporter = nodemailer.createTransport({
    host,
    port: Number.isNaN(port) ? 587 : port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
    ...(isGmail && { tls: { rejectUnauthorized: true } }),
  });
  return transporter;
}

export async function sendMail({ to, subject, html, text }) {
  const recipient = (to && typeof to === 'string' ? to : '').trim();
  if (!recipient || !EMAIL_REGEX.test(recipient)) {
    throw new Error('Valid email address is required to send mail');
  }

  const t = getTransporter();
  if (!t) {
    throw new Error(
      'Email is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env. For Gmail use an App Password.'
    );
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@pravidya.com';
  const plainText = text || (html ? html.replace(/<[^>]+>/g, '') : undefined);
  const mailOptions = { from, to: recipient, subject, html: html || text, text: plainText };

  const info = await t.sendMail(mailOptions);
  console.log('[Email] Sent to', recipient, '| MessageId:', info.messageId);
  return true;
}
