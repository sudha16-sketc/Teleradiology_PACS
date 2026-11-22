export function minutesBetween(
  from: Date | null | undefined,
  to: Date | null | undefined,
): number | null {
  if (!from || !to) return null;
  const elapsedMs = to.getTime() - from.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  return Math.round(elapsedMs / 60_000);
}
