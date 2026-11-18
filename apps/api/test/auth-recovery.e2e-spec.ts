import 'reflect-metadata';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { hash } from 'bcryptjs';
import type { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, prisma, USERS } from './helpers.js';
import { AuthRateLimitService } from '../src/auth/auth-rate-limit.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

let app: INestApplication;
let server: any;
let userId: string;
let email: string;
let resetToken = '';
let oldSession: ReturnType<typeof request.agent>;
let fetchMock: jest.SpyInstance;

const originalEnv = new Map<string, string | undefined>();
const authEnv = {
  RESEND_API_KEY: 'test-resend-key',
  EMAIL_FROM: 'Axis Tests <no-reply@example.test>',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  AUTH_LOGIN_MAX_ATTEMPTS: '2',
  AUTH_LOGIN_WINDOW_SECONDS: '900',
  AUTH_RECOVERY_MAX_REQUESTS: '10',
  AUTH_RECOVERY_WINDOW_SECONDS: '900',
};

const testIpPrefix = `2001:db8:${randomUUID().replace(/-/g, '').slice(0, 4)}::`;

function testIp(suffix: number): string {
  return `${testIpPrefix}${suffix}`;
}

function setIp(agent: any, ip: string) {
  return agent.set('X-Forwarded-For', ip);
}

beforeAll(async () => {
  for (const [key, value] of Object.entries(authEnv)) {
    originalEnv.set(key, process.env[key]);
    process.env[key] = value;
  }
  const built = await createTestApp();
  app = built.app;
  server = built.server;
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const adminAgent = await loginAgent(server, USERS.ADMIN);
  const adminUsers = await adminAgent.get('/api/users').expect(200);
  expect(Array.isArray(adminUsers.body.data)).toBe(true);

  email = `auth-recovery-${randomUUID()}@example.test`;
  const passwordHash = await hash('OldPass123!', 4);
  const user = await prisma.user.create({
    data: {
      email,
      displayName: 'Authentication Recovery Test',
      role: UserRole.RADIOLOGIST,
      status: 'APPROVED',
      isActive: true,
      passwordHash,
    },
  });
  userId = user.id;

  oldSession = request.agent(server);
  await setIp(oldSession, testIp(31))
    .post('/api/auth/login')
    .send({ email, password: 'OldPass123!' })
    .expect(201);
});

afterAll(async () => {
  fetchMock?.mockRestore();
  if (userId) {
    await prisma.passwordResetToken.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { actorId: userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await prisma.$disconnect();
  if (app) await app.close();
});

describe('Authentication recovery and abuse controls', () => {
  it('returns the same generic forgot-password response for existing and unknown email', async () => {
    let emailPayload: { html: string } | undefined;
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      emailPayload = JSON.parse(String(init?.body)) as { html: string };
      return new Response(null, { status: 200 });
    });

    const existing = await setIp(request.agent(server), testIp(32))
      .post('/api/auth/forgot-password')
      .send({ email: email.toUpperCase() })
      .expect(201);
    const missing = await setIp(request.agent(server), testIp(33))
      .post('/api/auth/forgot-password')
      .send({ email: `unknown-${randomUUID()}@example.test` })
      .expect(201);

    expect(existing.body).toEqual(missing.body);
    expect(existing.body.data.message).toMatch(/If an account exists/);
    expect(emailPayload?.html).toContain('reset-password?token=');
    const resetUrl = emailPayload?.html.match(/href="([^"]+)"/)?.[1];
    expect(resetUrl).toBeTruthy();
    resetToken = new URL(resetUrl!).searchParams.get('token') ?? '';
    expect(resetToken).toHaveLength(43);
    expect(JSON.stringify(existing.body)).not.toContain(resetToken);
    const stored = await prisma.passwordResetToken.findFirst({
      where: { userId },
      select: { tokenHash: true },
    });
    expect(stored?.tokenHash).toHaveLength(64);
    expect(stored?.tokenHash).not.toBe(resetToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid and expired reset tokens', async () => {
    await setIp(request.agent(server), testIp(34))
      .post('/api/auth/reset-password')
      .send({
        token: randomUUID().replace(/-/g, '').repeat(2),
        password: 'NewPass456!',
        confirmPassword: 'NewPass456!',
      })
      .expect(400);

    const expiredToken = randomUUID().replace(/-/g, '').repeat(2);
    await prisma.passwordResetToken.create({
      data: {
        tokenHash: createHash('sha256').update(expiredToken).digest('hex'),
        userId,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await setIp(request.agent(server), testIp(35))
      .post('/api/auth/reset-password')
      .send({
        token: expiredToken,
        password: 'NewPass456!',
        confirmPassword: 'NewPass456!',
      })
      .expect(400);
  });

  it('limits failed logins by IP and normalized email and returns Retry-After', async () => {
    await setIp(request.agent(server), testIp(36))
      .post('/api/auth/login')
      .send({ email: email.toUpperCase(), password: 'WrongPass123!' })
      .expect(401);

    await setIp(request.agent(server), testIp(37))
      .post('/api/auth/login')
      .send({ email, password: 'OldPass123!' })
      .expect(201);

    await setIp(request.agent(server), testIp(38))
      .post('/api/auth/login')
      .send({ email, password: 'WrongPass123!' })
      .expect(401);
    await setIp(request.agent(server), testIp(39))
      .post('/api/auth/login')
      .send({ email, password: 'WrongPass123!' })
      .expect(401);

    const blockedAccount = await setIp(request.agent(server), testIp(40))
      .post('/api/auth/login')
      .send({ email, password: 'OldPass123!' })
      .expect(429);
    expect(Number(blockedAccount.headers['retry-after'])).toBeGreaterThan(0);

    const sharedIp = testIp(41);
    await setIp(request.agent(server), sharedIp)
      .post('/api/auth/login')
      .send({ email: `missing-a-${randomUUID()}@example.test`, password: 'WrongPass123!' })
      .expect(401);
    await setIp(request.agent(server), sharedIp)
      .post('/api/auth/login')
      .send({ email: `missing-b-${randomUUID()}@example.test`, password: 'WrongPass123!' })
      .expect(401);
    await setIp(request.agent(server), sharedIp)
      .post('/api/auth/login')
      .send({ email: `missing-c-${randomUUID()}@example.test`, password: 'WrongPass123!' })
      .expect(429);
  });

  it('shares recovery counters across separate limiter instances', async () => {
    const originalMax = process.env.AUTH_RECOVERY_MAX_REQUESTS;
    process.env.AUTH_RECOVERY_MAX_REQUESTS = '2';
    const first = app.get(AuthRateLimitService);
    const second = new AuthRateLimitService(app.get(PrismaService));
    const req = {
      ip: testIp(46),
      socket: { remoteAddress: testIp(46) },
    } as unknown as Request;
    let retryAfter: string | number | undefined;
    const res = {
      setHeader: (name: string, value: string | number) => {
        if (name === 'Retry-After') retryAfter = value;
      },
    } as unknown as Response;

    try {
      const uniqueIdentifier = `multi-instance-${randomUUID()}@example.test`;
      await first.assertRecoveryAllowed(req, 'forgot', uniqueIdentifier, res);
      await second.assertRecoveryAllowed(req, 'forgot', uniqueIdentifier, res);
      let status: number | undefined;
      try {
        await first.assertRecoveryAllowed(req, 'forgot', uniqueIdentifier, res);
      } catch (error) {
        if (error instanceof HttpException) status = error.getStatus();
        else throw error;
      }
      expect(status).toBe(429);
      expect(Number(retryAfter)).toBeGreaterThan(0);
    } finally {
      if (originalMax === undefined) delete process.env.AUTH_RECOVERY_MAX_REQUESTS;
      else process.env.AUTH_RECOVERY_MAX_REQUESTS = originalMax;
    }
  });

  it('resets the password once, invalidates existing sessions, and permits the new password', async () => {
    const reset = await setIp(request.agent(server), testIp(42))
      .post('/api/auth/reset-password')
      .send({
        token: resetToken,
        password: 'NewPass456!',
        confirmPassword: 'NewPass456!',
      })
      .expect(201);
    expect(reset.body.data.success).toBe(true);

    await oldSession.get('/api/auth/me').expect(401);
    await setIp(request.agent(server), testIp(43))
      .post('/api/auth/reset-password')
      .send({
        token: resetToken,
        password: 'NewPass789!',
        confirmPassword: 'NewPass789!',
      })
      .expect(400);
    await setIp(request.agent(server), testIp(44))
      .post('/api/auth/login')
      .send({ email, password: 'OldPass123!' })
      .expect(401);
    await setIp(request.agent(server), testIp(45))
      .post('/api/auth/login')
      .send({ email, password: 'NewPass456!' })
      .expect(201);
  });

  it('rejects ADMIN assignment through the API and preserves normal admin operations', async () => {
    const adminAgent = await loginAgent(server, USERS.ADMIN);
    await request(server)
      .post('/api/auth/register')
      .send({
        displayName: 'Self Promotion Attempt',
        email: `self-admin-attempt-${randomUUID()}@example.test`,
        requestedRole: 'ADMIN',
        password: 'GoodPass123!',
        confirmPassword: 'GoodPass123!',
      })
      .expect(400);

    await adminAgent
      .post('/api/users')
      .send({
        displayName: 'Privilege Escalation Attempt',
        email: `admin-attempt-${randomUUID()}@example.test`,
        role: 'ADMIN',
        password: 'GoodPass123!',
      })
      .expect(400);
    await adminAgent.patch(`/api/users/${userId}`).send({ role: 'ADMIN' }).expect(400);

    const pending = await prisma.user.create({
      data: {
        email: `pending-admin-attempt-${randomUUID()}@example.test`,
        displayName: 'Pending Promotion Attempt',
        role: UserRole.RADIOLOGIST,
        requestedRole: UserRole.RADIOLOGIST,
        status: 'PENDING',
        passwordHash: await hash('GoodPass123!', 4),
      },
    });
    await adminAgent
      .post(`/api/auth/registration-requests/${pending.id}/approve`)
      .send({ role: 'ADMIN' })
      .expect(400);
    await prisma.user.delete({ where: { id: pending.id } });

    await adminAgent.patch(`/api/users/${userId}`).send({ role: 'MANAGER' }).expect(200);
    await adminAgent.patch(`/api/users/${userId}`).send({ role: 'RADIOLOGIST' }).expect(200);
    await adminAgent.get('/api/users').expect(200);
  });
});
