import { useEffect, useRef } from 'react';
import { getSocket, joinRoom, leaveRoom, STAFF_JOIN_REFUSED_EVENT } from './socket';

export type GradingEvent =
  | { type: 'grading'; kind: string; answerIds: number[] }
  | { type: 'session' }
  /** (Re)connected, or the server dropped/refused this client: reload everything. */
  | { type: 'resync' };

/**
 * Staff-room events WITH their payload, for the whole-quiz page, which refreshes only the answers
 * that changed (grading:changed carries answerIds) instead of reloading every answer. The other
 * staff pages use useStaffLive.
 */
export function useGradingEvents(sessionId: number, onEvent: (e: GradingEvent) => void): void {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    if (!Number.isSafeInteger(sessionId)) return;
    const socket = getSocket();
    const onGrading = (p: { kind?: unknown; answerIds?: unknown }) => {
      const ids = Array.isArray(p?.answerIds) ? p.answerIds.filter((x): x is number => typeof x === 'number') : [];
      handler.current({ type: 'grading', kind: typeof p?.kind === 'string' ? p.kind : '', answerIds: ids });
    };
    const onSession = () => handler.current({ type: 'session' });
    const onConnect = () => handler.current({ type: 'resync' });
    const onDisconnect = (reason: string) => {
      if (reason === 'io server disconnect') handler.current({ type: 'resync' });
    };
    const onRefused = (e: Event) => {
      if ((e as CustomEvent<number>).detail === sessionId) handler.current({ type: 'resync' });
    };
    joinRoom('staff', sessionId);
    socket.on('grading:changed', onGrading);
    socket.on('session:update', onSession);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    window.addEventListener(STAFF_JOIN_REFUSED_EVENT, onRefused);
    return () => {
      socket.off('grading:changed', onGrading);
      socket.off('session:update', onSession);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      window.removeEventListener(STAFF_JOIN_REFUSED_EVENT, onRefused);
      leaveRoom('staff', sessionId);
    };
  }, [sessionId]);
}
