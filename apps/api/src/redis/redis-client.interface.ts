/** Minimal Redis command surface used by the API. Kept small so it can be
 * replaced by an in-memory double in tests without coupling them to ioredis. */
export interface RedisCommands {
  connect?(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<'OK' | null>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, ttlSeconds: number): Promise<number>;
  incr(key: string): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<string>;
  disconnect(): void;
}

export const REDIS_CLIENT = Symbol('AXIS_REDIS_CLIENT');

/** Thrown for every Redis transport/command failure. Auth callers must fail
 * closed on this error instead of treating the request as unauthenticated. */
export class RedisUnavailableError extends Error {
  constructor(message = 'Redis is temporarily unavailable') {
    super(message);
    this.name = 'RedisUnavailableError';
  }
}
