import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { UserRole, UserStatus } from '@prisma/client';
import { sessionExpirySeconds } from '../auth/auth.constants.js';
import {
  sessionIndexKey,
  sessionKey,
} from './redis.config.js';
import { RedisService } from './redis.service.js';

const SESSION_INDEX_GRACE_SECONDS = 24 * 60 * 60;

/** Session state stored in Redis. Never contains passwords, password hashes or
 * clinical data — PostgreSQL remains authoritative for identity and roles. */
export interface StoredSession {
  sessionId: string;
  userId: string;
  role: UserRole;
  tenantId: string | null;
  status: 'ACTIVE';
  authVersion: number;
  createdAt: string;
  expiresAt: string;
}

export interface CreateSessionInput {
  sessionId: string;
  userId: string;
  role: UserRole;
  tenantId: string | null;
  authVersion: number;
}

@Injectable()
export class RedisSessionService {
  constructor(private readonly redis: RedisService) {}

  async create(input: CreateSessionInput, ttlSeconds = sessionExpirySeconds()): Promise<StoredSession> {
    const createdAt = Date.now();
    const record: StoredSession = {
      sessionId: input.sessionId,
      userId: input.userId,
      role: input.role,
      tenantId: input.tenantId,
      status: 'ACTIVE',
      authVersion: input.authVersion,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + ttlSeconds * 1000).toISOString(),
    };

    await this.redis.set(sessionKey(input.sessionId), JSON.stringify(record), ttlSeconds);
    try {
      await this.redis.sadd(sessionIndexKey(input.userId), input.sessionId);
      await this.redis.expire(
        sessionIndexKey(input.userId),
        ttlSeconds + SESSION_INDEX_GRACE_SECONDS,
      );
    } catch (error) {
      // An orphaned session record with no index would escape bulk revocation.
      await this.redis.del(sessionKey(input.sessionId)).catch(() => undefined);
      throw error;
    }
    return record;
  }

  /** Returns the Redis session record, or throws 401 for missing, corrupt or
   * expired sessions. Redis outages surface as RedisUnavailableError so the
   * caller can return 503 instead of silently allowing access. */
  async validate(sessionId: string): Promise<StoredSession> {
    const raw = await this.redis.get(sessionKey(sessionId));
    if (!raw) throw new UnauthorizedException('Session expired or invalid');

    let record: StoredSession;
    try {
      record = JSON.parse(raw) as StoredSession;
    } catch {
      await this.revoke(sessionId).catch(() => undefined);
      throw new UnauthorizedException('Session expired or invalid');
    }

    if (
      !record ||
      record.sessionId !== sessionId ||
      record.status !== 'ACTIVE' ||
      !record.userId ||
      !Date.parse(record.expiresAt) ||
      Date.parse(record.expiresAt) <= Date.now()
    ) {
      await this.revoke(sessionId).catch(() => undefined);
      throw new UnauthorizedException('Session expired or invalid');
    }
    return record;
  }

  /** Compile-time identity check against the user freshly loaded from
   * PostgreSQL. This blocks role/tenant drift even if a cache is stale. */
  assertMatches(
    session: StoredSession,
    user: {
      id: string;
      role: UserRole;
      status: UserStatus;
      hospitalId?: string | null;
      authVersion: number;
    },
  ): void {
    if (
      session.userId !== user.id ||
      session.role !== user.role ||
      session.tenantId !== (user.hospitalId ?? null) ||
      session.authVersion !== user.authVersion
    ) {
      throw new UnauthorizedException('Session expired or invalid');
    }
  }

  async revoke(sessionId: string | undefined | null): Promise<void> {
    if (!sessionId) return;
    // Best-effort index cleanup: the session key is the revocation authority.
    const record = await this.redis.get(sessionKey(sessionId)).catch(() => null);
    await this.redis.del(sessionKey(sessionId));
    if (record) {
      try {
        const parsed = JSON.parse(record) as StoredSession;
        if (parsed.userId) await this.redis.srem(sessionIndexKey(parsed.userId), sessionId);
      } catch {
        // Corrupt record: the index entry is harmless and expires on its own.
      }
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const indexKey = sessionIndexKey(userId);
    const sessionIds = await this.redis.smembers(indexKey);
    if (sessionIds.length > 0) {
      await this.redis.del(...sessionIds.map((id) => sessionKey(id)));
    }
    await this.redis.del(indexKey);
  }

  /** Rotate on every new login/refresh so a pre-authentication session id can
   * never be promoted into an authenticated one (session fixation). */
  async rotate(
    previousSessionId: string | undefined | null,
    input: CreateSessionInput,
  ): Promise<StoredSession> {
    const created = await this.create(input);
    if (previousSessionId && previousSessionId !== input.sessionId) {
      await this.revoke(previousSessionId);
    }
    return created;
  }
}
