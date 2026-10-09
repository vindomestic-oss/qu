/** "m:ss" until endsAt; "0:00" once it has passed. With startedAt, a clock tick that is up to a second
 *  old cannot show more than the time limit (e.g. 60:01 right after Start). */
export function formatCountdown(endsAt: string, now: number, startedAt?: string | null): string {
  const effectiveNow = startedAt ? Math.max(now, Date.parse(startedAt)) : now;
  const remainingMs = new Date(endsAt).getTime() - effectiveNow;
  if (remainingMs <= 0) return '0:00';
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
