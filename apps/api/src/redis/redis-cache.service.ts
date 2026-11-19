import { Injectable } from '@nestjs/common';
import { log } from '../common/observability/structured-logger.js';
import {
  CACHE_GENERATION_TTL_SECONDS,
  cacheGenerationKey,
  cacheKey,
} from './redis.config.js';
import { RedisService } from './redis.service.js';

export const CACHE_NAMESPACES = {
  hospitalConfig: 'hospital-config',
  userMetadata: 'user-metadata',
} as const;

/** Small, tenant-scoped cache for non-sensitive reference data. Cache failures
 * never change authorization: callers fall back to PostgreSQL, and no
 * authorization decision or clinical image is ever served from this cache. */
@Injectable()
export class RedisCacheService {
  constructor(private readonly redis: RedisService) {}

  async getOrSet<T>(options: {
    namespace: string;
    tenantId?: string | null;
    key: string;
    ttlSeconds: number;
    loader: () => Promise<T>;
  }): Promise<T> {
    const { namespace, tenantId, key, ttlSeconds, loader } = options;
    const generation = await this.currentGeneration(namespace, tenantId);
    const resolvedKey = cacheKey(namespace, tenantId, generation, key);

    try {
      const cached = await this.redis.get(resolvedKey);
      if (cached !== null) {
        return JSON.parse(cached) as T;
      }
    } catch (error) {
      // Corrupt JSON or a Redis error must not break the request.
      log('warn', 'cache_read_failed', {
        namespace,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    const value = await loader();
    try {
      await this.redis.set(resolvedKey, JSON.stringify(value), ttlSeconds);
    } catch {
      log('warn', 'cache_write_failed', { namespace });
    }
    return value;
  }

  /** Invalidate a whole namespace for one tenant (or globally) by advancing a
   * generation counter. Old entries stay until TTL but become unaddressable. */
  async invalidate(namespace: string, tenantId?: string | null): Promise<void> {
    try {
      const generationKey = cacheGenerationKey(namespace, tenantId);
      await this.redis.incr(generationKey);
      await this.redis.expire(generationKey, CACHE_GENERATION_TTL_SECONDS);
    } catch {
      log('warn', 'cache_invalidation_failed', { namespace });
    }
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.invalidate(CACHE_NAMESPACES.userMetadata, userId);
  }

  async invalidateHospital(hospitalId: string): Promise<void> {
    await this.invalidate(CACHE_NAMESPACES.hospitalConfig, hospitalId);
  }

  private async currentGeneration(
    namespace: string,
    tenantId?: string | null,
  ): Promise<number> {
    try {
      const raw = await this.redis.get(cacheGenerationKey(namespace, tenantId));
      const value = Number(raw);
      return Number.isInteger(value) && value > 0 ? value : 1;
    } catch {
      return 1;
    }
  }
}
