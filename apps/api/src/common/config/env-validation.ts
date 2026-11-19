import { logger } from '../observability/structured-logger.js';
import { isWeakSecret, MIN_AUTH_SECRET_LENGTH } from '../../auth/auth.constants.js';

/**
 * fail-fast startup validation for mandatory configuration.
 * AUTH_SECRET is checked independent of the environment name: the API refuses
 * to start whenever the signing secret is missing, a known-weak default, or too
 * short to be trusted. Remaining mandatory variables (DB, CORS, Orthanc) are
 * enforced in production so local workflows keep sensible defaults.
 */
export function isProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.AXIS_ENV === 'production'
  );
}

export const DEV_DEFAULT_SECRET = 'axis-dev-secret-change-in-production';

const PRODUCTION_REQUIRED: Array<{ key: string; why: string }> = [
  { key: 'DATABASE_URL', why: 'PostgreSQL connection string' },
  { key: 'REDIS_URL', why: 'Redis URL for centralized sessions and cache' },
  { key: 'AUTH_SECRET', why: 'session/JWT signing secret' },
  { key: 'CORS_ORIGIN', why: 'allow-listed frontend origin(s)' },
  { key: 'ORTHANC_URL', why: 'Orthanc service URL for DICOM storage/proxy' },
  { key: 'RESEND_API_KEY', why: 'password-reset email delivery via Resend' },
  { key: 'EMAIL_FROM', why: 'verified sender address for password-reset email' },
  { key: 'NEXT_PUBLIC_APP_URL', why: 'public frontend origin for password-reset links' },
];

export function assertRequiredEnv(): void {
  const missing: string[] = [];

  // Independent of environment name: a configured signing secret must be real
  // and strong (never a known-weak value or too short). A MISSING secret in
  // development falls back to an ephemeral random per-process secret, so it is
  // only a hard failure in production.
  const secret = process.env.AUTH_SECRET;
  if (secret) {
    if (isWeakSecret(secret)) {
      missing.push(
        `AUTH_SECRET (value is a known default or shorter than ${MIN_AUTH_SECRET_LENGTH} chars)`,
      );
    }
  } else if (isProduction()) {
    missing.push(`AUTH_SECRET (${MIN_AUTH_SECRET_LENGTH}+ random chars)`);
  }

  if (isProduction()) {
    for (const { key, why } of PRODUCTION_REQUIRED) {
      if (!process.env[key]) {
        missing.push(`${key} (${why})`);
      }
    }
  }

  const boundedIntegers: Array<{
    key: string;
    min: number;
    max: number;
  }> = [
    { key: 'AUTH_LOGIN_MAX_ATTEMPTS', min: 1, max: 1000 },
    { key: 'AUTH_LOGIN_WINDOW_SECONDS', min: 1, max: 86400 },
    { key: 'AUTH_RECOVERY_MAX_REQUESTS', min: 1, max: 1000 },
    { key: 'AUTH_RECOVERY_WINDOW_SECONDS', min: 1, max: 86400 },
    { key: 'PASSWORD_RESET_TOKEN_TTL_MINUTES', min: 15, max: 30 },
    { key: 'AXIS_ORTHANC_TIMEOUT_MS', min: 1000, max: 600000 },
    { key: 'AXIS_ORTHANC_STREAM_IDLE_TIMEOUT_MS', min: 1000, max: 600000 },
    { key: 'AXIS_ORTHANC_HEALTH_TIMEOUT_MS', min: 500, max: 60000 },
    { key: 'REDIS_CONNECT_TIMEOUT_MS', min: 100, max: 60000 },
    { key: 'REDIS_COMMAND_TIMEOUT_MS', min: 100, max: 60000 },
    { key: 'REDIS_RETRY_MAX_DELAY_MS', min: 100, max: 30000 },
    { key: 'SESSION_EXPIRY', min: 60, max: 86400 },
    { key: 'SESSION_TTL_SECONDS', min: 60, max: 86400 },
  ];
  for (const { key, min, max } of boundedIntegers) {
    const raw = process.env[key];
    if (raw !== undefined) {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < min || value > max) {
        missing.push(`${key} (must be an integer from ${min} to ${max})`);
      }
    }
  }

  if (isProduction()) {
    const rawRedisUrl = process.env.REDIS_URL;
    if (rawRedisUrl) {
      try {
        const parsed = new URL(rawRedisUrl);
        if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
          missing.push('REDIS_URL (must use redis:// or rediss://)');
        }
        if (!parsed.password && !process.env.REDIS_PASSWORD) {
          missing.push(
            'REDIS_URL (must embed a password or set REDIS_PASSWORD; Redis must require authentication)',
          );
        }
      } catch {
        missing.push('REDIS_URL (must be a valid redis:// URL)');
      }
    }

    const rawOrthancUrl = process.env.ORTHANC_URL;
    if (rawOrthancUrl) {
      const candidate = /^https?:\/\//i.test(rawOrthancUrl)
        ? rawOrthancUrl
        : `http://${rawOrthancUrl}`;
      try {
        const parsed = new URL(candidate);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          missing.push('ORTHANC_URL (must use http or https)');
        }
        if (parsed.username || parsed.password || parsed.search || parsed.hash) {
          missing.push('ORTHANC_URL (must not contain credentials, query or fragment)');
        }
        const loopback = /^(localhost|127\.|::1|\[::1\])$/i.test(parsed.hostname);
        if (loopback && process.env.AXIS_ALLOW_LOOPBACK_ORTHANC !== '1') {
          missing.push(
            'ORTHANC_URL (loopback is not reachable from a deployed API; set a real Orthanc host or AXIS_ALLOW_LOOPBACK_ORTHANC=1 for local production testing)',
          );
        }
      } catch {
        missing.push('ORTHANC_URL (must be a valid URL or host:port)');
      }
    }
  }

  if (missing.length > 0) {
    logger.error('environment_validation_failed', {
      missing,
      env: process.env.NODE_ENV ?? 'development',
    });
    throw new Error(`Refusing to start: invalid environment: ${missing.join('; ')}`);
  }
}