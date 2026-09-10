import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

const env = process.env.NODE_ENV ?? 'development';
const isProduction = env === 'production';

const jwtSecret = process.env.JWT_SECRET ?? (isProduction ? '' : 'dev-only-insecure-secret-do-not-use-in-production');

if (isProduction && (!jwtSecret || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must be set to at least 32 characters in production.');
}

export const config = {
  env,
  isProduction,
  isTest: env === 'test',
  port: num(process.env.PORT, 4000),
  serverRoot,

  jwtSecret,
  sessionIdleMinutes: num(process.env.SESSION_IDLE_MINUTES, 60),
  sessionAbsoluteHours: num(process.env.SESSION_ABSOLUTE_HOURS, 12),
  loginMaxAttempts: num(process.env.LOGIN_MAX_ATTEMPTS, 5),
  loginLockoutMinutes: num(process.env.LOGIN_LOCKOUT_MINUTES, 15),
  cookieSecure: bool(process.env.COOKIE_SECURE, isProduction),
  cookieName: 'mpp_session',

  databaseFile: path.resolve(serverRoot, process.env.DATABASE_FILE ?? './data/portal.db'),

  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',

  staleProjectDays: num(process.env.STALE_PROJECT_DAYS, 14),

  mail: {
    transport: process.env.MAIL_TRANSPORT ?? 'console',
    from: process.env.MAIL_FROM ?? 'ApniLeap Portfolio Portal <no-reply@apnileap.example>',
    host: process.env.SMTP_HOST ?? '',
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },

  seedPassword: process.env.SEED_PASSWORD ?? 'Passw0rd!2026',
};
