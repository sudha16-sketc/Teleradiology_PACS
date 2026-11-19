import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { log } from '../common/observability/structured-logger.js';
import {
  redisCommandTimeoutMs,
  redisConnectTimeoutMs,
  redisMaxRetryDelayMs,
  resolveRedisUrl,
} from './redis.config.js';
import {
  REDIS_CLIENT,
  RedisCommands,
  RedisUnavailableError,
} from './redis-client.interface.js';

let lastRetryLogAt = 0;

/** Creates the single shared ioredis connection used by the whole API process.
 * Never log the resolved URL: it can contain the Redis password. */
export function createRedisClient(): RedisCommands {
  const client = new Redis(resolveRedisUrl(), {
    lazyConnect: true,
    connectTimeout: redisConnectTimeoutMs(),
    commandTimeout: redisCommandTimeoutMs(),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
      const delay = Math.min(
        200 * 2 ** Math.min(Math.max(times - 1, 0), 10),
        redisMaxRetryDelayMs(),
      );
      if (Date.now() - lastRetryLogAt > 5000) {
        lastRetryLogAt = Date.now();
        log('warn', 'redis_reconnecting', { attempt: times, delayMs: delay });
      }
      return delay;
    },
  });
  return client as unknown as RedisCommands;
}

/** Thin reliability layer around the Redis client: bounded timeouts, bounded
 * reconnect backoff, structured logs and fail-closed error translation. */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private ready = false;
  private connectedAt: string | null = null;
  private lastErrorAt: string | null = null;
  private operations = 0;
  private failures = 0;

  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisCommands) {
    const events = this.client as unknown as {
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
    events.on?.('ready', () => {
      this.ready = true;
      this.connectedAt = new Date().toISOString();
      log('info', 'redis_ready');
    });
    events.on?.('end', () => {
      this.ready = false;
      log('warn', 'redis_connection_ended');
    });
    events.on?.('error', (error: unknown) => {
      this.ready = false;
      this.lastErrorAt = new Date().toISOString();
      this.failures += 1;
      // Error text may contain connection details; log only the error class.
      log('warn', 'redis_error', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.withTimeout(
        async () => {
          if (this.client.connect) await this.client.connect();
          await this.client.ping();
        },
        redisConnectTimeoutMs(),
      );
      this.ready = true;
      this.connectedAt = new Date().toISOString();
      log('info', 'redis_initial_probe_ok');
    } catch (error) {
      this.ready = false;
      this.lastErrorAt = new Date().toISOString();
      this.failures += 1;
      log('warn', 'redis_initial_probe_failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
    this.ready = false;
    log('info', 'redis_disconnected');
  }

  isReady(): boolean {
    const status = (this.client as unknown as { status?: string }).status;
    if (status !== undefined && status !== 'ready') return false;
    return this.ready;
  }

  stats(): Record<string, unknown> {
    return {
      ready: this.isReady(),
      operations: this.operations,
      failures: this.failures,
      connectedAt: this.connectedAt,
      lastErrorAt: this.lastErrorAt,
    };
  }

  /** Timed probe for readiness. Liveness never calls this. */
  async probe(timeoutMs = redisConnectTimeoutMs()): Promise<{
    up: boolean;
    latencyMs: number;
  }> {
    const start = process.hrtime.bigint();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.client.ping(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new RedisUnavailableError('Redis probe timed out')),
            timeoutMs,
          );
        }),
      ]);
      this.ready = true;
      return { up: true, latencyMs: Math.round(Number(process.hrtime.bigint() - start) / 1e6) };
    } catch {
      this.ready = false;
      this.lastErrorAt = new Date().toISOString();
      return { up: false, latencyMs: Math.round(Number(process.hrtime.bigint() - start) / 1e6) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  get(key: string): Promise<string | null> {
    return this.command('get', () => this.client.get(key));
  }

  set(key: string, value: string, ttlSeconds: number): Promise<'OK' | null> {
    return this.command('set', () => this.client.set(key, value, 'EX', ttlSeconds));
  }

  del(...keys: string[]): Promise<number> {
    return this.command('del', () => this.client.del(...keys));
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    return this.command('sadd', () => this.client.sadd(key, ...members));
  }

  srem(key: string, ...members: string[]): Promise<number> {
    return this.command('srem', () => this.client.srem(key, ...members));
  }

  smembers(key: string): Promise<string[]> {
    return this.command('smembers', () => this.client.smembers(key));
  }

  expire(key: string, ttlSeconds: number): Promise<number> {
    return this.command('expire', () => this.client.expire(key, ttlSeconds));
  }

  incr(key: string): Promise<number> {
    return this.command('incr', () => this.client.incr(key));
  }

  private async withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new RedisUnavailableError('Redis connection timed out')),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async command<T>(label: string, operation: () => Promise<T>): Promise<T> {
    this.operations += 1;
    try {
      return await operation();
    } catch (error) {
      this.failures += 1;
      this.ready = false;
      this.lastErrorAt = new Date().toISOString();
      log('warn', 'redis_command_failed', {
        command: label,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      if (error instanceof RedisUnavailableError) throw error;
      throw new RedisUnavailableError(`Redis command ${label} failed`);
    }
  }
}
