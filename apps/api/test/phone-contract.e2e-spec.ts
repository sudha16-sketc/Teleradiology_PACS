import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp } from './app-bootstrap.js';
import { loginAgent, prisma, USERS } from './helpers.js';

let app: INestApplication;
let server: any;
let adminAgent: any;
let rad1Agent: any;
let rad1Id: string;
let originalPhone: string | null;

const createdUserIds: string[] = [];
const createdHospitalIds: string[] = [];

beforeAll(async () => {
  const built = await createTestApp();
  app = built.app;
  server = built.server;
  adminAgent = await loginAgent(server, USERS.ADMIN);
  rad1Agent = await loginAgent(server, USERS.RAD1);
  const rad1 = await prisma.user.findUniqueOrThrow({ where: { email: USERS.RAD1.email } });
  rad1Id = rad1.id;
  originalPhone = rad1.phone;
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ actorId: { in: createdUserIds } }, { resourceId: { in: createdUserIds } }],
      },
    });
  }
  if (createdHospitalIds.length) {
    await prisma.auditLog.deleteMany({
      where: { resourceId: { in: createdHospitalIds } },
    });
  }
  for (const id of createdUserIds) {
    await prisma.user.deleteMany({ where: { id } });
  }
  for (const id of createdHospitalIds) {
    await prisma.hospital.deleteMany({ where: { id } });
  }
  await prisma.user.update({ where: { id: rad1Id }, data: { phone: originalPhone } });
  await prisma.$disconnect();
  await app.close();
});

describe('Phone API contract', () => {
  it('accepts ten digits on registration and stores canonical E.164', async () => {
    const email = `phone-register-${randomUUID()}@example.test`;
    const res = await requestRegistration({ email, phone: '9876543210' }).expect(201);
    expect(res.body.data.phone).toBe('+919876543210');
    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdUserIds.push(stored.id);
    expect(stored.phone).toBe('+919876543210');
  });

  it('rejects a prefixed phone on registration', async () => {
    await requestRegistration({
      email: `phone-register-bad-${randomUUID()}@example.test`,
      phone: '+919876543210',
    }).expect(400);
  });
});

function requestRegistration(input: { email: string; phone: string }) {
  return request(server).post('/api/auth/register').send({
    displayName: 'Phone Contract User',
    email: input.email,
    phone: input.phone,
    requestedRole: 'RADIOLOGIST',
    password: 'GoodPass123!',
    confirmPassword: 'GoodPass123!',
  });
}

describe('Phone API contract for authenticated mutations', () => {
  it('accepts ten digits on profile update and stores canonical E.164', async () => {
    const res = await rad1Agent
      .patch('/api/auth/me')
      .send({ phone: '9876543211' })
      .expect(200);
    expect(res.body.data.phone).toBe('+919876543211');
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: rad1Id } });
    expect(stored.phone).toBe('+919876543211');
  });

  it('rejects a prefixed phone on profile update', async () => {
    await rad1Agent.patch('/api/auth/me').send({ phone: '+919876543212' }).expect(400);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: rad1Id } });
    expect(stored.phone).toBe('+919876543211');
  });

  it('accepts ten digits on hospital creation and stores canonical E.164', async () => {
    const code = `PH${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const res = await adminAgent
      .post('/api/hospitals')
      .send({
        name: `Phone Contract Hospital ${code}`,
        code,
        address: '1 Test Street',
        phone: '9876543213',
      })
      .expect(201);
    createdHospitalIds.push(res.body.data.id);
    expect(res.body.data.phone).toBe('+919876543213');
    const stored = await prisma.hospital.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(stored.phone).toBe('+919876543213');
  });

  it('rejects a prefixed phone on hospital creation', async () => {
    const code = `PB${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    await adminAgent
      .post('/api/hospitals')
      .send({
        name: `Phone Contract Hospital Bad ${code}`,
        code,
        phone: '+919876543214',
      })
      .expect(400);
  });

  it('accepts ten digits on user creation and update and stores canonical E.164', async () => {
    const email = `phone-user-${randomUUID()}@example.test`;
    const created = await adminAgent
      .post('/api/users')
      .send({
        displayName: 'Phone Contract Managed User',
        email,
        role: 'RADIOLOGIST',
        password: 'GoodPass123!',
        phone: '9876543215',
      })
      .expect(201);
    createdUserIds.push(created.body.data.id);
    expect(created.body.data.phone).toBe('+919876543215');

    const updated = await adminAgent
      .patch(`/api/users/${created.body.data.id}`)
      .send({ phone: '9876543216' })
      .expect(200);
    expect(updated.body.data.phone).toBe('+919876543216');
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(stored.phone).toBe('+919876543216');
  });

  it('rejects a prefixed phone on user creation and update', async () => {
    const email = `phone-user-bad-${randomUUID()}@example.test`;
    const created = await adminAgent
      .post('/api/users')
      .send({
        displayName: 'Phone Contract Bad User',
        email,
        role: 'RADIOLOGIST',
        password: 'GoodPass123!',
        phone: '+919876543217',
      })
      .expect(400);
    expect(created.body).toBeTruthy();
  });
});
