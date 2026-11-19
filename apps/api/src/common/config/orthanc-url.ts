export function parseOrthancUrl(rawValue?: string | null): URL {
  const raw = (rawValue ?? '').trim() || 'http://localhost:8042';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('must be a valid URL or host:port');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('must use http or https');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('must not contain credentials, query or fragment');
  }
  if (parsed.pathname.replace(/\/+$/, '') !== '') {
    throw new Error('must be an origin only, without /dicom-web or any path');
  }

  parsed.pathname = '/';
  return parsed;
}

export function isLoopbackOrthancUrl(parsed: URL): boolean {
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

const PRIVATE_ORTHANC_HOSTNAMES = new Set(['axis-orthanc']);

export function isPrivateOrthancUrl(parsed: URL): boolean {
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return PRIVATE_ORTHANC_HOSTNAMES.has(hostname);
}

export function orthancBaseUrl(): string {
  return parseOrthancUrl(process.env.ORTHANC_URL).origin;
}
