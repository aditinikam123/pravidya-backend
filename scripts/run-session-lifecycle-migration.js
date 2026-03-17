/**
 * Run session lifecycle migration.
 * Uses: npx prisma db execute --file
 *
 * Run: node scripts/run-session-lifecycle-migration.js
 * Or: npx prisma db execute --file prisma/migrations/20250219000000_session_lifecycle/migration.sql
 */
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, '..');
const migrationPath = path.join(backendDir, 'prisma/migrations/20260127110922_session_lifecycle/migration.sql');

execSync(`npx prisma db execute --file "${migrationPath}"`, {
  cwd: backendDir,
  stdio: 'inherit',
});
console.log('Session lifecycle migration completed.');
