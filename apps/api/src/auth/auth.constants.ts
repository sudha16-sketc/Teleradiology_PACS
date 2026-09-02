import type { UserRole, UserStatus } from '@prisma/client';

export const SESSION_COOKIE = 'axis_session';
export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

export function sessionSecret(): string {
  return process.env.AUTH_SECRET ?? 'axis-dev-secret-change-in-production';
}

export function sessionExpirySeconds(): number {
  const raw = Number(process.env.SESSION_EXPIRY ?? '3600');
  return Number.isFinite(raw) && raw > 0 ? raw : 3600;
}

export interface SessionPayload {
  sub: string;
  email: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
}

export const DUMMY_PASSWORD_HASH =
  '$2a$12$7QyZ3aB1VpHpNzjYvQ4TpOrTxW2fv3VKDjWXPuR0m5W5Sh9mSXHbe';