import 'reflect-metadata';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './app-bootstrap.js';
import { RetentionSchedulerService } from '../src/retention/retention-scheduler.service.js';

const SECRET = 'retention-cron-test-secret-0123456789';
const ENV_KEYS = [
  'RETENTION_CRON_SECRET',
  'RETENTION_SCHEDULER_ENABLED',
  'RETENTION_DRY_RUN',
  'RETENTION_DELETE_ENABLED',
  'RETENTION_BACKUP_DELETE_ENABLED',
];
const previousEnv: Record<string, string | undefined> = {};

let app: INestApplication;
let server: any;
let tickSpy: jest.SpiedFunction<RetentionSchedulerService['tick']>;

beforeAll(async () => {
  for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
  process.env.RETENTION_CRON_SECRET = SECRET;
  process.env.RETENTION_SCHEDULER_ENABLED = 'false';
  process.env.RETENTION_DRY_RUN = 'true';
  process.env.RETENTION_DELETE_ENABLED = 'false';
  process.env.RETENTION_BACKUP_DELETE_ENABLED = 'false';

  const built = await createTestApp();
  app = built.app;
  server = built.server;
  tickSpy = jest
    .spyOn(app.get(RetentionSchedulerService), 'tick')
    .mockResolvedValue({ claimed: 0, processed: 0, failed: 0, skipped: false });
});

beforeEach(() => {
  tickSpy.mockClear();
  tickSpy.mockResolvedValue({ claimed: 0, processed: 0, failed: 0, skipped: false });
});

afterAll(async () => {
  tickSpy.mockRestore();
  await app.close();
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

describe('retention cron trigger', () => {
  it('keeps the liveness endpoint public and side-effect free', async () => {
    const response = await request(server).get('/api/health/live').expect(200);
    expect(response.body.status).toBe('ok');
    expect(tickSpy).not.toHaveBeenCalled();
  });

  it('rejects a missing cron secret', async () => {
    await request(server).post('/api/internal/retention/tick').expect(401);
    expect(tickSpy).not.toHaveBeenCalled();
  });

  it('rejects an invalid cron secret', async () => {
    await request(server)
      .post('/api/internal/retention/tick')
      .set('X-Cron-Secret', 'wrong-secret')
      .expect(401);
    expect(tickSpy).not.toHaveBeenCalled();
  });

  it('rejects all requests when the cron secret is unset', async () => {
    process.env.RETENTION_CRON_SECRET = '';
    await request(server)
      .post('/api/internal/retention/tick')
      .set('X-Cron-Secret', SECRET)
      .expect(401);
    expect(tickSpy).not.toHaveBeenCalled();
    process.env.RETENTION_CRON_SECRET = SECRET;
  });

  it('accepts the configured secret and reports the scheduler result', async () => {
    const response = await request(server)
      .post('/api/internal/retention/tick')
      .set('X-Cron-Secret', SECRET)
      .expect(200);
    expect(tickSpy).toHaveBeenCalledTimes(1);
    expect(response.body.data).toEqual({
      claimed: 0,
      processed: 0,
      failed: 0,
      skipped: false,
      accepted: true,
    });
    expect(response.body.meta.triggeredAt).toEqual(expect.any(String));
  });

  it('reports a skipped trigger without claiming duplicate work', async () => {
    tickSpy.mockResolvedValueOnce({ claimed: 0, processed: 0, failed: 0, skipped: true });
    const response = await request(server)
      .post('/api/internal/retention/tick')
      .set('X-Cron-Secret', SECRET)
      .expect(200);
    expect(response.body.data).toMatchObject({ skipped: true, accepted: false });
  });

  it('does not expose the admin execute endpoint to the cron secret', async () => {
    await request(server)
      .post('/api/admin/retention/execute')
      .set('X-Cron-Secret', SECRET)
      .expect(401);
  });
});
