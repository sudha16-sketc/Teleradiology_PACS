import { isProduction } from '../common/config/env-validation.js';

export const SESSION_NAMESPACE = 'session';
export const SESSION_INDEX_NAMESPACE = 'session-index';
export const CACHE_NAMESPACE = 'cache';
export const CACHE_GENERATION_NAMESPACE = 'cache-gen';

export const HOSPITAL_CONFIG_CACHE = 'hospital-config';
export const HOSPITAL_CONFIG_TTL_SECONDS = 300;
export const CACHE_GENERATION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Key prefix shared by sessions, session indexes and disposable caches. */
export function redisKeyPrefix(): string {
  const raw = (process.env.REDIS_KEY_PREFIX ?? 'axis').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : 'axis';
}

/**
 * Resolve the Redis connection URL. A separate REDIS_PASSWORD is injected into
 * the URL when it is not already embedded, so deployments can keep the password
 * in their secret store without putting it in a connection string.
 */
export function resolveRedisUrl(): string {
  const configured = process.env.REDIS_URL?.trim();
  if (!configured) {
    if (isProduction()) {
      throw new Error('REDIS_URL is required in production (Redis-backed sessions)');
    }
    return 'redis://127.0.0.1:6379';
  }
  const password = process.env.REDIS_PASSWORD?.trim();
  if (!password) return configured;
  try {
    const url = new URL(configured);
    if (url.password) return configured;
    url.password = password;
    return url.toString();
  } catch {
    return configured;
  }
}

export function redisConnectTimeoutMs(): number {
  return boundedInt('REDIS_CONNECT_TIMEOUT_MS', 3000, 100, 60000);
}

export function redisCommandTimeoutMs(): number {
  return boundedInt('REDIS_COMMAND_TIMEOUT_MS', 2000, 100, 60000);
}

export function redisMaxRetryDelayMs(): number {
  return boundedInt('REDIS_RETRY_MAX_DELAY_MS', 2000, 100, 30000);
}

function boundedInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function safePart(value: string, fallback: string): string {
  return /^[A-Za-z0-9_.:@-]{1,128}$/.test(value) ? value : fallback;
}

export function sessionKey(sessionId: string): string {
  return `${redisKeyPrefix()}:${SESSION_NAMESPACE}:${safePart(sessionId, 'invalid')}`;
}

export function sessionIndexKey(userId: string): string {
  return `${redisKeyPrefix()}:${SESSION_INDEX_NAMESPACE}:${safePart(userId, 'invalid')}`;
}

export function cacheGenerationKey(namespace: string, tenantId?: string | null): string {
  return `${redisKeyPrefix()}:${CACHE_GENERATION_NAMESPACE}:${safePart(namespace, 'unknown')}:${safePart(tenantId ?? 'global', 'global')}`;
}

export function cacheKey(
  namespace: string,
  tenantId: string | null | undefined,
  generation: number,
  key: string,
): string {
  return `${redisKeyPrefix()}:${CACHE_NAMESPACE}:${safePart(namespace, 'unknown')}:${safePart(tenantId ?? 'global', 'global')}:${generation}:${safePart(key, 'invalid')}`;
}
