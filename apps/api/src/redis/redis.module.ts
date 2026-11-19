import { Global, Module } from '@nestjs/common';
import { REDIS_CLIENT } from './redis-client.interface.js';
import { createRedisClient, RedisService } from './redis.service.js';
import { RedisSessionService } from './redis-session.service.js';
import { RedisCacheService } from './redis-cache.service.js';

/** Single global Redis connection shared by auth, health and caching. */
@Global()
@Module({
  providers: [
    { provide: REDIS_CLIENT, useFactory: createRedisClient },
    RedisService,
    RedisSessionService,
    RedisCacheService,
  ],
  exports: [RedisService, RedisSessionService, RedisCacheService],
})
export class RedisModule {}
