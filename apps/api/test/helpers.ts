import request from 'supertest';
import { PrismaClient } from '@prisma/client';

export interface TestUser {
  email: string;
  password: string;
}

export const USERS: Record<'ADMIN' | 'MANAGER' | 'RAD1' | 'RAD2' | 'H_CGH' | 'H_MMC' | 'H_RTC', TestUser> = {
  ADMIN: { email: 'admin@axisradiology.com', password: 'Admin@123456' },
  MANAGER: { email: 'manager@axisradiology.com', password: 'AxisDev123!' },
  RAD1: { email: 'dr.chen@axisradiology.com', password: 'AxisDev123!' },
  RAD2: { email: 'dr.patel@axisradiology.com', password: 'AxisDev123!' },
  H_CGH: { email: 'registrar@citygeneral.com', password: 'AxisDev123!' },
  H_MMC: { email: 'records@metrocenter.com', password: 'AxisDev123!' },
  H_RTC: { email: 'rad@regionaltrauma.com', password: 'AxisDev123!' },
};

export type Agent = ReturnType<typeof request.agent>;

export async function loginAgent(
  server: any,
  user: TestUser,
): Promise<Agent> {
  const agent = request.agent(server);
  const res = await agent
    .post('/api/auth/login')
    .send({ email: user.email, password: user.password });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Login failed for ${user.email}: ${res.status} ${res.text}`);
  }
  return agent;
}

export const prisma = new PrismaClient();
