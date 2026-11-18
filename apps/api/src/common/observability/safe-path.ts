const UID_SEGMENTS = new Set([
  'studies',
  'series',
  'instances',
  'patients',
  'frames',
]);

export function safeRequestPath(url: string): string {
  const pathname = (url ?? '').split('?')[0].split('#')[0];
  if (!pathname) return '/';
  return pathname
    .split('/')
    .map((segment, index, segments) => {
      const previous = segments[index - 1]?.toLowerCase();
      if (previous && UID_SEGMENTS.has(previous) && segment) return ':uid';
      if (/^\d+(?:\.\d+)+$/.test(segment)) return ':uid';
      return segment;
    })
    .join('/');
}
