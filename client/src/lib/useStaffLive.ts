import { useEffect, useRef } from 'react';
import { getSocket, joinRoom, leaveRoom, STAFF_JOIN_REFUSED_EVENT } from './socket';
import { createRefetchScheduler } from './refetchScheduler';

export type StaffEvent = 'session:live' | 'grading:changed' | 'session:update';

const THROTTLE_MS = 1000;

/**
 * Staff-room subscription for admin and grader screens: joins `staff:<id>` and refetches on every
 * listed event and after a reconnect, at most once per second (lib/refetchScheduler.ts). `intervals`
 * slows single events down, e.g. { 'session:live': 5000 } for a screen whose counters may lag a few
 * seconds (one session:live per 500 ms per session during a quiz). When `refetch` returns a promise,
 * requests never overlap: one that falls due meanwhile runs once after it. A null sessionId does
 * nothing, so it can be called unconditionally.
 */
export function useStaffLive(
  sessionId: number | null,
  refetch: () => unknown,
  { events, intervals = {} }: { events: StaffEvent[]; intervals?: Partial<Record<StaffEvent, number>> },
): void {
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });
  const eventsKey = events.join(',');
  const intervalsKey = JSON.stringify(intervals);

  useEffect(() => {
    if (sessionId === null) return;
    const socket = getSocket();
    const gaps = JSON.parse(intervalsKey) as Partial<Record<StaffEvent, number>>;
    const scheduler = createRefetchScheduler(() => refetchRef.current(), { afterFlightGapMs: THROTTLE_MS });
    const soon = () => scheduler.request(THROTTLE_MS);
    // The server dropped this client (a revoked grader link) or refused the room: refetch, so the
    // request's 401 leads to "access expired or revoked" instead of a silently frozen page.
    const onDisconnect = (reason: string) => {
      if (reason === 'io server disconnect') soon();
    };
    const onRefused = (e: Event) => {
      if ((e as CustomEvent<number>).detail === sessionId) soon();
    };
    const handlers = (eventsKey.split(',') as StaffEvent[]).map((name) => {
      const gap = gaps[name] ?? THROTTLE_MS;
      return [name, () => scheduler.request(gap)] as const;
    });
    joinRoom('staff', sessionId);
    for (const [name, handler] of handlers) socket.on(name, handler);
    socket.on('connect', soon);
    socket.on('disconnect', onDisconnect);
    window.addEventListener(STAFF_JOIN_REFUSED_EVENT, onRefused);
    return () => {
      for (const [name, handler] of handlers) socket.off(name, handler);
      socket.off('connect', soon);
      socket.off('disconnect', onDisconnect);
      window.removeEventListener(STAFF_JOIN_REFUSED_EVENT, onRefused);
      scheduler.stop();
      leaveRoom('staff', sessionId);
    };
  }, [sessionId, eventsKey, intervalsKey]);
}
