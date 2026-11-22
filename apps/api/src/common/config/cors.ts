export interface CorsConfig {
  origin: true | string[];
  credentials: boolean;
}

export function resolveCors(raw = process.env.CORS_ORIGIN ?? 'http://localhost:3000'): CorsConfig {
  const origins = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (origins.includes('*')) {
    return { origin: true, credentials: false };
  }
  return { origin: origins, credentials: true };
}
