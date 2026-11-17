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
  { key: 'AUTH_SECRET', why: 'session/JWT signing secret' },
  { key: 'CORS_ORIGIN', why: 'allow-listed frontend origin(s)' },
  { key: 'ORTHANC_URL', why: 'Orthanc service URL for DICOM storage/proxy' },
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

  if (missing.length > 0) {
    logger.error('environment_validation_failed', {
      missing,
      env: process.env.NODE_ENV ?? 'development',
    });
    throw new Error(`Refusing to start: invalid environment: ${missing.join('; ')}`);
  }
}