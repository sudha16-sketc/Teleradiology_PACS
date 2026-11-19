import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { RedisService } from '../src/redis/redis.service.js';
import { DicomWebService } from '../src/dicomweb/dicomweb.service.js';
import { RedisSessionService } from '../src/redis/redis-session.service.js';
import { createInMemoryRedisClient } from './app-bootstrap.js';

function makeSessions(): RedisSessionService {
  return new RedisSessionService(new RedisService(createInMemoryRedisClient()));
}

const input = (sessionId: string, userId: string) => ({
  sessionId,
  userId,
  role: UserRole.HOSPITAL,
  tenantId: 'hospital-1',
  authVersion: 1,
});

describe('RedisSessionService', () => {
  it('creates and validates a session without storing sensitive data', async () => {
    const sessions = makeSessions();
    const sessionId = randomUUID();
    const created = await sessions.create(input(sessionId, 'user-1'), 60);

    expect(created.sessionId).toBe(sessionId);
    expect(created.status).toBe('ACTIVE');
    expect(JSON.stringify(created)).not.toContain('password');
    await expect(sessions.validate(sessionId)).resolves.toMatchObject({
      sessionId,
      userId: 'user-1',
      tenantId: 'hospital-1',
      authVersion: 1,
    });
  });

  it('rejects identity drift and expired or revoked sessions', async () => {
    const sessions = makeSessions();
    const sessionId = randomUUID();
    const record = await sessions.create(input(sessionId, 'user-1'), 60);
    const user = {
      id: 'user-1',
      role: UserRole.HOSPITAL,
      status: UserStatus.APPROVED,
      hospitalId: 'hospital-1',
      authVersion: 1,
    };

    expect(() => sessions.assertMatches(record, user)).not.toThrow();
    expect(() =>
      sessions.assertMatches(record, { ...user, authVersion: 2 }),
    ).toThrow(UnauthorizedException);
    expect(() =>
      sessions.assertMatches(record, { ...user, hospitalId: 'hospital-2' }),
    ).toThrow(UnauthorizedException);

    await sessions.revoke(sessionId);
    await expect(sessions.validate(sessionId)).rejects.toThrow(UnauthorizedException);
  });

  it('rotates sessions and revokes every session for a user', async () => {
    const sessions = makeSessions();
    const first = randomUUID();
    const second = randomUUID();
    const third = randomUUID();

    await sessions.create(input(first, 'user-1'), 60);
    await sessions.rotate(first, input(second, 'user-1'));
    await expect(sessions.validate(first)).rejects.toThrow(UnauthorizedException);
    await expect(sessions.validate(second)).resolves.toMatchObject({ sessionId: second });

    await sessions.create(input(third, 'user-1'), 60);
    await sessions.revokeAllForUser('user-1');
    await expect(sessions.validate(second)).rejects.toThrow(UnauthorizedException);
    await expect(sessions.validate(third)).rejects.toThrow(UnauthorizedException);
  });
});

describe('DICOMweb gateway session binding', () => {
  const gateway = new DicomWebService(null as never, null as never);
  const user = { id: 'user-1', role: UserRole.HOSPITAL, hospitalId: 'hospital-1' };
  const session = {
    sessionId: randomUUID(),
    userId: 'user-1',
    role: UserRole.HOSPITAL,
    tenantId: 'hospital-1',
    status: 'ACTIVE' as const,
    authVersion: 1,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };

  it('accepts a session that matches the PostgreSQL user and tenant', () => {
    expect(() =>
      gateway.assertGatewaySession({ session } as never, user),
    ).not.toThrow();
  });

  it('rejects missing, cross-user and cross-tenant sessions', () => {
    expect(() => gateway.assertGatewaySession({} as never, user)).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      gateway.assertGatewaySession({ session: { ...session, userId: 'user-2' } } as never, user),
    ).toThrow(UnauthorizedException);
    expect(() =>
      gateway.assertGatewaySession(
        { session: { ...session, tenantId: 'hospital-2' } } as never,
        user,
      ),
    ).toThrow(UnauthorizedException);
  });
});
