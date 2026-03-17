/**
 * Load .env before any other application code.
 * Must be the first import in server.js so GEMINI_* and other vars are available when routes load.
 * Uses path relative to this file so .env is found regardless of process.cwd().
 */
import dns from 'dns';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

// On some networks IPv6 can be flaky; on others forcing IPv4 can break Neon.
// Only prefer IPv4 when explicitly enabled so server matches testConnection behavior by default.
try {
  if (process.env.DNS_IPV4_FIRST === '1') {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (_) {}

// Help debug Intelligence (Gemini): log whether key is loaded (never log the key itself)
const key = process.env.GEMINI_API_KEY;
if (key && key.trim()) {
  console.log('[env] GEMINI_API_KEY is set (length', key.trim().length + ')');
} else {
  console.warn('[env] GEMINI_API_KEY is missing or empty. Set it in backend/.env for Intelligence features. Get a key: https://aistudio.google.com/app/apikey');
}
