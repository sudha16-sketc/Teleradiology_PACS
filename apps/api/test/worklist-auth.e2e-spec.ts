import 'reflect-metadata';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, USERS, prisma } from './helpers.js';
import { RedisSessionService } from '../src/redis/redis-session.service.js';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  SESSION_COOKIE,
  sessionSecret,
} from '../src/auth/auth.constants.js';
import type { INestApplication } from '@nestjs/common';

let app: INestApplication;
let server: any;
let sessions: RedisSessionService;

const OHIF_ORIGIN = 'https://teleradiology-pacs-1.onrender.com';

function signedSession(
  user: { id: string; email: string; authVersion: number },
  jti: string,
  expiresIn: number,
): string {
  return jwt.sign(
    { sub: user.id, email: user.email, authVersion: user.authVersion },
    sessionSecret(),
    {
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      jwtid: jti,
      expiresIn,
    },
  );
}

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;
  sessions = app.get(RedisSessionService);
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe('worklist authentication', () => {
  it.each([
    ['radiologist', USERS.RAD1],
    ['manager', USERS.MANAGER],
    ['administrator', USERS.ADMIN],
  ])('accepts an authenticated %s request', async (_role, credentials) => {
    const agent = await loginAgent(server, credentials);
    const res = await agent.get('/api/worklist/my').expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('rejects a missing session', async () => {
    const res = await request(server).get('/api/worklist/my').expect(401);
    expect(res.body.message).toBe('Not authenticated');
  });

  it('rejects an expired session', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: USERS.RAD1.email },
      select: { id: true, email: true, role: true, hospitalId: true, authVersion: true },
    });
    const jti = randomUUID();
    await sessions.create(
      {
        sessionId: jti,
        userId: user.id,
        role: user.role,
        tenantId: user.hospitalId ?? null,
        authVersion: user.authVersion,
      },
      60,
    );

    const res = await request(server)
      .get('/api/worklist/my')
      .set('Cookie', `${SESSION_COOKIE}=${signedSession(user, jti, -1)}`)
      .expect(401);
    expect(res.body.message).toBe('Session expired or invalid');
  });

  it('rejects an invalid session identifier', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: USERS.RAD1.email },
      select: { id: true, email: true, authVersion: true },
    });
    const token = signedSession(user, randomUUID(), 60);

    const res = await request(server)
      .get('/api/worklist/my')
      .set('Cookie', `${SESSION_COOKIE}=${token}`)
      .expect(401);
    expect(res.body.message).toBe('Session expired or invalid');
  });

  it('accepts a credentialed cross-origin worklist request', async () => {
    const agent = await loginAgent(server, USERS.RAD1);
    const res = await agent
      .get('/api/worklist/my')
      .set('Origin', OHIF_ORIGIN)
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe(OHIF_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects worklist access after logout and allows it again after reauthentication', async () => {
    const agent = await loginAgent(server, USERS.RAD1);
    await agent.get('/api/worklist/my').expect(200);

    await agent.post('/api/auth/logout').expect(201);
    await agent.get('/api/worklist/my').expect(401);

    const reauthenticated = await loginAgent(server, USERS.RAD1);
    await reauthenticated.get('/api/worklist/my').expect(200);
  });
});
