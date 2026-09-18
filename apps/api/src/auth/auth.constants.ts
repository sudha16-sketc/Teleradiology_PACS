import crypto from 'node:crypto';
import type { UserRole, UserStatus } from '@prisma/client';
import { logger } from '../common/observability/structured-logger.js';

export const SESSION_COOKIE = 'axis_session';
export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

export const JWT_ISSUER = 'axis-api';
export const JWT_AUDIENCE = 'axis-web';
export const JWT_ALGORITHM = 'HS256' as const;
export const MIN_AUTH_SECRET_LENGTH = 32;

/**
 * Signing secrets that are public knowledge (documented defaults/placeholders)
 * must never be used to sign sessions, regardless of the environment name.
 */
export const WEAK_AUTH_SECRETS = new Set<string>([
  '',
  'axis-dev-secret-change-in-production',
  'change-me-to-a-long-random-value-in-production',
  'change-me-in-production',
]);

function isStrictEnv(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.AXIS_ENV === 'production' ||
    process.env.NODE_ENV === 'test'
  );
}

export function isWeakSecret(secret: string): boolean {
  return WEAK_AUTH_SECRETS.has(secret) || secret.length < MIN_AUTH_SECRET_LENGTH;
}

/**
 * Resolve the AUTH_SECRET used to sign/verify sessions.
 *
 * - A configured secret that is not a known weak value is always used.
 * - A known-weak value is never used, even in development.
 * - In production/test a missing or weak secret is a hard startup failure.
 * - In development a missing secret falls back to a random per-process secret
 *   (sessions do not survive restarts), so local workflows keep working without
 *   ever relying on a repo-public literal.
 */
export function sessionSecret(): string {
  const configured = process.env.AUTH_SECRET;

  if (configured && !WEAK_AUTH_SECRETS.has(configured)) {
    if (configured.length >= MIN_AUTH_SECRET_LENGTH) {
      return configured;
    }
    if (isStrictEnv()) {
      throw new Error(
        `AUTH_SECRET is too short (< ${MIN_AUTH_SECRET_LENGTH} chars); refusing to start in ${process.env.NODE_ENV ?? 'this'} environment.`,
      );
    }
    logger.warn('auth_secret_short', {
      length: configured.length,
      message: `AUTH_SECRET is shorter than ${MIN_AUTH_SECRET_LENGTH} chars; token security is reduced.`,
    });
    return configured;
  }

  if (isStrictEnv()) {
    throw new Error(
      'AUTH_SECRET must be set to a random value of at least ' +
        `${MIN_AUTH_SECRET_LENGTH} characters (and must not be a known default). ` +
        'Generate one with: openssl rand -base64 48',
    );
  }

  const ephemeral = crypto.randomBytes(48).toString('base64');
  logger.warn('auth_secret_ephemeral', {
    message:
      'AUTH_SECRET not set; generated an ephemeral secret for this process only. ' +
      'Sessions will be invalidated on restart and tokens are not stable across instances.',
  });
  return ephemeral;
}

export function sessionExpirySeconds(): number {
  const raw = Number(process.env.SESSION_EXPIRY ?? '3600');
  return Number.isFinite(raw) && raw > 0 ? raw : 3600;
}

export interface SessionPayload {
  sub: string;
  email: string;
  jti?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  hospitalId?: string;
}

export const DUMMY_PASSWORD_HASH =
  '$2a$12$7QyZ3aB1VpHpNzjYvQ4TpOrTxW2fv3VKDjWXPuR0m5W5Sh9mSXHbe';