import { useEffect, useRef } from 'react';
import { getSocket, joinRoom, leaveRoom, STAFF_JOIN_REFUSED_EVENT } from './socket';

export type StaffEvent = 'session:live' | 'grading:changed' | 'session:update';

const THROTTLE_MS = 1000;

/**
 * Staff-room subscription for admin (and, from S12, grader) screens: joins `staff:<id>`, refetches on
 * every listed event and after a reconnect, at most once per second (first call at once, one trailing
 * call for whatever arrived meanwhile). A null sessionId does nothing, so it can be called unconditionally.
 */
export function useStaffLive(sessionId: number | null, refetch: () => void, { events }: { events: StaffEvent[] }): void {
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });
  const eventsKey = events.join(',');

  useEffect(() => {
    if (sessionId === null) return;
    const socket = getSocket();
    let last = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      last = Date.now();
      refetchRef.current();
    };
    const throttled = () => {
      const wait = THROTTLE_MS - (Date.now() - last);
      if (wait <= 0 && !trailing) run();
      else if (!trailing) {
        trailing = setTimeout(() => {
          trailing = null;
          run();
        }, Math.max(wait, 0));
      }
    };
    // The server dropped this client (a revoked grader link) or refused the room: refetch, so the
    // request's 401 leads to "access expired or revoked" instead of a silently frozen page.
    const onDisconnect = (reason: string) => {
      if (reason === 'io server disconnect') throttled();
    };
    const onRefused = (e: Event) => {
      if ((e as CustomEvent<number>).detail === sessionId) throttled();
    };
    const names = eventsKey.split(',') as StaffEvent[];
    joinRoom('staff', sessionId);
    for (const name of names) socket.on(name, throttled);
    socket.on('connect', throttled);
    socket.on('disconnect', onDisconnect);
    window.addEventListener(STAFF_JOIN_REFUSED_EVENT, onRefused);
    return () => {
      for (const name of names) socket.off(name, throttled);
      socket.off('connect', throttled);
      socket.off('disconnect', onDisconnect);
      window.removeEventListener(STAFF_JOIN_REFUSED_EVENT, onRefused);
      if (trailing) clearTimeout(trailing);
      leaveRoom('staff', sessionId);
    };
  }, [sessionId, eventsKey]);
}
