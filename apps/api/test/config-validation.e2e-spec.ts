import { assertRequiredEnv } from '../src/common/config/env-validation.js';
import { resolveCors } from '../src/common/config/cors.js';
import { orthancBaseUrl, parseOrthancUrl } from '../src/common/config/orthanc-url.js';

const KEYS = [
  'AXIS_ENV',
  'DATABASE_URL',
  'REDIS_URL',
  'AUTH_SECRET',
  'CORS_ORIGIN',
  'ORTHANC_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'NEXT_PUBLIC_APP_URL',
  'AXIS_ALLOW_LOOPBACK_ORTHANC',
] as const;

type Saved = Record<string, string | undefined>;

function productionEnv(orthancUrl: string): void {
  process.env.AXIS_ENV = 'production';
  process.env.DATABASE_URL = 'postgresql://axis:axis@localhost:5432/axis_pacs_test';
  process.env.REDIS_URL = 'redis://:test@localhost:6379';
  process.env.AUTH_SECRET = 'axis-e2e-test-only-secret-0123456789abcdef0123456789abcdef';
  process.env.CORS_ORIGIN = 'https://front.example.test';
  process.env.ORTHANC_URL = orthancUrl;
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.EMAIL_FROM = 'no-reply@example.test';
  process.env.NEXT_PUBLIC_APP_URL = 'https://front.example.test';
  delete process.env.AXIS_ALLOW_LOOPBACK_ORTHANC;
}

describe('CORS credential policy', () => {
  it('allows credentials only for explicit origins', () => {
    expect(
      resolveCors('https://app.example.test, https://viewer.example.test'),
    ).toEqual({
      origin: ['https://app.example.test', 'https://viewer.example.test'],
      credentials: true,
    });
  });

  it('never combines a wildcard origin with credentials', () => {
    expect(resolveCors('*')).toEqual({ origin: true, credentials: false });
    expect(resolveCors('https://app.example.test,*')).toEqual({
      origin: true,
      credentials: false,
    });
  });
});

describe('production Orthanc URL validation', () => {
  let saved: Saved;

  beforeEach(() => {
    saved = {};
    for (const key of KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('accepts an HTTPS origin', () => {
    productionEnv('https://orthanc.example.test');
    expect(() => assertRequiredEnv()).not.toThrow();
  });

  it('accepts the private Render Orthanc hostname over http', () => {
    productionEnv('http://axis-orthanc:8042');
    expect(() => assertRequiredEnv()).not.toThrow();
    expect(orthancBaseUrl()).toBe('http://axis-orthanc:8042');
  });

  it('rejects a /dicom-web suffix', () => {
    productionEnv('https://orthanc.example.test/dicom-web');
    expect(() => assertRequiredEnv()).toThrow(/without \/dicom-web or any path/);
    expect(() => parseOrthancUrl('https://orthanc.example.test/dicom-web')).toThrow(
      /without \/dicom-web or any path/,
    );
  });

  it('rejects embedded credentials and non-HTTPS production origins', () => {
    productionEnv('https://user:pass@orthanc.example.test');
    expect(() => assertRequiredEnv()).toThrow(/must not contain credentials/);

    productionEnv('http://orthanc.example.test');
    expect(() => assertRequiredEnv()).toThrow(/must use https in production/);
  });

  it('normalizes an origin-only URL without appending a path', () => {
    process.env.ORTHANC_URL = 'https://orthanc.example.test/';
    expect(orthancBaseUrl()).toBe('https://orthanc.example.test');
  });
});
