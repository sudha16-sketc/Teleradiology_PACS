export function orthancBaseUrl(): string {
  const raw = (process.env.ORTHANC_URL ?? 'http://localhost:8042').trim();
  if (!raw) return 'http://localhost:8042';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '');
}
