import { logger } from '../observability/structured-logger.js';

/**
 * fail-fast startup validation for mandatory production environment variables.
 * In development/test, sensible defaults are permitted so local workflows keep
 * working. In production the API refuses to start with missing mandatory
 * configuration or with the insecure development-only default secret.
 */
export function isProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.AXIS_ENV === 'production'
  );
}

const PRODUCTION_REQUIRED: Array<{ key: string; why: string }> = [
  { key: 'DATABASE_URL', why: 'PostgreSQL connection string' },
  { key: 'AUTH_SECRET', why: 'session/JWT signing secret' },
  { key: 'CORS_ORIGIN', why: 'allow-listed frontend origin(s)' },
  { key: 'ORTHANC_URL', why: 'Orthanc service URL for DICOM storage/proxy' },
];

const DEV_DEFAULT_SECRET = 'axis-dev-secret-change-in-production';

export function assertRequiredEnv(): void {
  if (!isProduction()) return;

  const missing: string[] = [];
  for (const { key, why } of PRODUCTION_REQUIRED) {
    if (!process.env[key]) {
      missing.push(`${key} (${why})`);
    }
  }
  if (process.env.AUTH_SECRET === DEV_DEFAULT_SECRET) {
    missing.push('AUTH_SECRET cannot be the development default secret in production');
  }

  if (missing.length > 0) {
    logger.error('production_environment_validation_failed', {
      missing,
    });
    throw new Error(
      `Refusing to start in production: missing/mandatory environment: ${missing.join('; ')}`,
    );
  }
}
